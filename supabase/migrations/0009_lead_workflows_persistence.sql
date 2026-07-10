-- Lead workflow persistence hardening.
--
-- Additive/conservative changes for production CRM lead-management workflows:
--   * follow-up stages are no longer capped at five configured steps;
--   * merged leads retain a reversible pointer to their survivor;
--   * common lost reasons exist as editable reference data;
--   * duplicate merge is performed by one transactional database function.

set search_path = public, extensions;

alter table public.lead_follow_up_stages
  drop constraint if exists lead_follow_up_stages_stage_number_check;

alter table public.lead_follow_up_stages
  add constraint lead_follow_up_stages_stage_number_positive_check
  check (stage_number > 0);

alter table public.leads
  add column if not exists merged_into_lead_id uuid references public.leads(id) on delete set null,
  add column if not exists merged_at timestamptz,
  add column if not exists merged_by uuid references public.crm_users(id) on delete set null,
  add column if not exists merge_notes text;

create index if not exists leads_merged_into_idx on public.leads(merged_into_lead_id);

insert into public.lost_reasons (label, display_order, is_active)
values
  ('No response', 10, true),
  ('Price issue', 20, true),
  ('Unavailable service', 30, true),
  ('Chose another clinic', 40, true)
on conflict do nothing;

create or replace function public.crm_merge_duplicate_flag(
  target_flag_id uuid,
  actor_id uuid,
  merge_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  flag_row public.lead_duplicate_flags%rowtype;
  primary_id uuid;
  duplicate_id uuid;
  primary_financials_id uuid;
  duplicate_financials_id uuid;
  now_ts timestamptz := now();
  moved_counts jsonb := '{}'::jsonb;
  primary_human_id text;
  duplicate_human_id text;
begin
  select *
    into flag_row
    from public.lead_duplicate_flags
   where id = target_flag_id
   for update;

  if not found then
    raise exception 'Duplicate flag % not found', target_flag_id;
  end if;

  if flag_row.status = 'merged' then
    return jsonb_build_object('already_merged', true);
  end if;

  primary_id := flag_row.lead_id;
  duplicate_id := flag_row.duplicate_lead_id;

  if primary_id = duplicate_id then
    raise exception 'Cannot merge a lead into itself';
  end if;

  select lead_id into primary_human_id from public.leads where id = primary_id for update;
  select lead_id into duplicate_human_id from public.leads where id = duplicate_id for update;

  if primary_human_id is null or duplicate_human_id is null then
    raise exception 'Both leads must exist before merge';
  end if;

  update public.crm_messages set lead_id = primary_id where lead_id = duplicate_id;
  moved_counts := moved_counts || jsonb_build_object('crm_messages', coalesce((select count(*) from public.crm_messages where lead_id = primary_id), 0));

  update public.lead_messages set lead_id = primary_id where lead_id = duplicate_id;
  update public.crm_comments set lead_id = primary_id where lead_id = duplicate_id;
  update public.crm_ai_reply_logs set lead_id = primary_id where lead_id = duplicate_id;
  update public.crm_unread_events set lead_id = primary_id where lead_id = duplicate_id;
  update public.ai_extraction_runs set lead_id = primary_id where lead_id = duplicate_id;
  update public.ai_suggestion_actions set lead_id = primary_id where lead_id = duplicate_id;
  update public.lead_stage_history set lead_id = primary_id where lead_id = duplicate_id;
  update public.lead_timeline_events set lead_id = primary_id where lead_id = duplicate_id;
  update public.escalations set lead_id = primary_id where lead_id = duplicate_id;
  update public.old_database_followups set lead_id = primary_id where lead_id = duplicate_id;

  insert into public.crm_lead_attribution (
    lead_id,
    first_source,
    first_campaign,
    first_ad_id,
    first_ad_name,
    first_referral_source,
    first_referral_type,
    first_referral_code,
    first_touch_at,
    first_referral,
    latest_source,
    latest_campaign,
    latest_ad_id,
    latest_ad_name,
    latest_referral_source,
    latest_referral_type,
    latest_referral_code,
    latest_touch_at,
    latest_referral,
    touch_count
  )
  select
    primary_id,
    first_source,
    first_campaign,
    first_ad_id,
    first_ad_name,
    first_referral_source,
    first_referral_type,
    first_referral_code,
    first_touch_at,
    first_referral,
    latest_source,
    latest_campaign,
    latest_ad_id,
    latest_ad_name,
    latest_referral_source,
    latest_referral_type,
    latest_referral_code,
    latest_touch_at,
    latest_referral,
    touch_count
  from public.crm_lead_attribution
  where lead_id = duplicate_id
  on conflict (lead_id) do update set
    latest_source = coalesce(excluded.latest_source, public.crm_lead_attribution.latest_source),
    latest_campaign = coalesce(excluded.latest_campaign, public.crm_lead_attribution.latest_campaign),
    latest_ad_id = coalesce(excluded.latest_ad_id, public.crm_lead_attribution.latest_ad_id),
    latest_ad_name = coalesce(excluded.latest_ad_name, public.crm_lead_attribution.latest_ad_name),
    latest_referral_source = coalesce(excluded.latest_referral_source, public.crm_lead_attribution.latest_referral_source),
    latest_referral_type = coalesce(excluded.latest_referral_type, public.crm_lead_attribution.latest_referral_type),
    latest_referral_code = coalesce(excluded.latest_referral_code, public.crm_lead_attribution.latest_referral_code),
    latest_touch_at = greatest(
      coalesce(public.crm_lead_attribution.latest_touch_at, excluded.latest_touch_at),
      coalesce(excluded.latest_touch_at, public.crm_lead_attribution.latest_touch_at)
    ),
    latest_referral = coalesce(excluded.latest_referral, public.crm_lead_attribution.latest_referral),
    touch_count = public.crm_lead_attribution.touch_count + coalesce(excluded.touch_count, 0),
    updated_at = now_ts;
  delete from public.crm_lead_attribution where lead_id = duplicate_id;

  update public.crm_conversations set lead_id = primary_id where lead_id = duplicate_id;

  select id into primary_financials_id
    from public.crm_lead_financials
   where lead_id = primary_id;
  select id into duplicate_financials_id
    from public.crm_lead_financials
   where lead_id = duplicate_id;

  if primary_financials_id is not null and duplicate_financials_id is not null then
    raise exception 'Both leads have financial records; reconcile payments before automatic merge';
  end if;

  if primary_financials_id is null and duplicate_financials_id is not null then
    update public.crm_lead_financials
       set lead_id = primary_id,
           updated_at = now_ts
     where id = duplicate_financials_id;
    update public.crm_financial_transactions set lead_id = primary_id where lead_id = duplicate_id;
    update public.crm_doctor_funded_payments set lead_id = primary_id where lead_id = duplicate_id;
    update public.crm_discount_approvals set lead_id = primary_id where lead_id = duplicate_id;
  end if;

  update public.lead_source_links lsl
     set lead_id = primary_id,
         is_primary = false,
         updated_at = now_ts
   where lsl.lead_id = duplicate_id
     and not exists (
       select 1
         from public.lead_source_links existing
        where existing.lead_id = primary_id
          and coalesce(existing.normalized_chat_link, '') = coalesce(lsl.normalized_chat_link, '')
          and coalesce(existing.normalized_platform_id, '') = coalesce(lsl.normalized_platform_id, '')
          and existing.platform = lsl.platform
     );

  delete from public.lead_source_links where lead_id = duplicate_id;

  insert into public.lead_tag_assignments (lead_id, tag_id, assigned_by, created_at)
  select primary_id, tag_id, coalesce(actor_id, assigned_by), now_ts
    from public.lead_tag_assignments
   where lead_id = duplicate_id
  on conflict (lead_id, tag_id) do nothing;
  delete from public.lead_tag_assignments where lead_id = duplicate_id;

  update public.lead_follow_up_stages lfus
     set lead_id = primary_id,
         updated_at = now_ts
   where lfus.lead_id = duplicate_id
     and not exists (
       select 1
         from public.lead_follow_up_stages existing
        where existing.lead_id = primary_id
          and existing.workflow_type = lfus.workflow_type
          and existing.stage_number = lfus.stage_number
     );
  update public.lead_follow_up_stages
     set status = 'skipped',
         notes = concat_ws(E'\n', notes, 'Skipped during merge into ' || primary_human_id),
         updated_at = now_ts
   where lead_id = duplicate_id
     and status <> 'completed';

  update public.lead_duplicate_flags
     set lead_id = primary_id
   where lead_id = duplicate_id and id <> target_flag_id;
  update public.lead_duplicate_flags
     set duplicate_lead_id = primary_id
   where duplicate_lead_id = duplicate_id and id <> target_flag_id;

  update public.leads
     set merged_into_lead_id = primary_id,
         merged_at = now_ts,
         merged_by = actor_id,
         merge_notes = nullif(trim(coalesce(merge_note, '')), ''),
         updated_at = now_ts
   where id = duplicate_id;

  update public.lead_duplicate_flags
     set status = 'merged',
         reviewed_by = actor_id,
         reviewed_at = now_ts,
         notes = nullif(trim(coalesce(merge_note, notes, '')), ''),
         updated_at = now_ts
   where id = target_flag_id;

  insert into public.duplicate_review_actions (duplicate_flag_id, action, action_by, notes, metadata)
  values (
    target_flag_id,
    'merged',
    actor_id,
    nullif(trim(coalesce(merge_note, '')), ''),
    jsonb_build_object(
      'primary_lead_id', primary_human_id,
      'duplicate_lead_id', duplicate_human_id,
      'primary_uuid', primary_id,
      'duplicate_uuid', duplicate_id
    )
  );

  insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, metadata)
  values (
    actor_id,
    'lead.duplicate_merged',
    'lead',
    primary_id,
    jsonb_build_object('duplicate_lead_id', duplicate_human_id, 'duplicate_uuid', duplicate_id),
    jsonb_build_object('merged_into_lead_id', primary_human_id, 'primary_uuid', primary_id),
    jsonb_build_object('duplicate_flag_id', target_flag_id, 'notes', merge_note)
  );

  insert into public.lead_timeline_events (lead_id, event_type, title, body, actor_user_id, metadata)
  values (
    primary_id,
    'duplicate_merged',
    'Duplicate merged',
    'Merged ' || duplicate_human_id || ' into ' || primary_human_id,
    actor_id,
    jsonb_build_object('duplicate_flag_id', target_flag_id, 'duplicate_uuid', duplicate_id)
  );

  return jsonb_build_object(
    'primary_lead_id', primary_human_id,
    'duplicate_lead_id', duplicate_human_id,
    'primary_uuid', primary_id,
    'duplicate_uuid', duplicate_id
  );
end;
$$;

grant execute on function public.crm_merge_duplicate_flag(uuid, uuid, text) to service_role;
