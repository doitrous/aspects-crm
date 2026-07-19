-- Recoverable lead deletion with a fixed 30-day retention window.
-- Apply to the CRM Supabase project before deploying the matching application.

set search_path = public, extensions;

alter table public.leads
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.crm_users(id) on delete set null,
  add column if not exists purge_after timestamptz;

alter table public.leads
  drop constraint if exists leads_trash_state_complete;

alter table public.leads
  add constraint leads_trash_state_complete check (
    (deleted_at is null and deleted_by is null and purge_after is null)
    or
    (deleted_at is not null and purge_after is not null)
  );

create index if not exists leads_active_updated_idx
  on public.leads(updated_at desc)
  where deleted_at is null;

create index if not exists leads_trash_purge_idx
  on public.leads(purge_after)
  where deleted_at is not null;

create or replace function public.crm_trash_lead(
  target_lead_id uuid,
  actor_id uuid
)
returns table(lead_id text, deleted_at timestamptz, purge_after timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  deleted_time timestamptz := clock_timestamp();
begin
  return query
  update public.leads as lead
  set deleted_at = deleted_time,
      deleted_by = actor_id,
      purge_after = deleted_time + interval '30 days',
      has_unread = false,
      unread_since = null,
      is_reply_overdue = false,
      reply_overdue_at = null,
      updated_at = deleted_time
  where lead.id = target_lead_id
    and lead.deleted_at is null
  returning lead.lead_id, lead.deleted_at, lead.purge_after;
end;
$$;

create or replace function public.crm_restore_trashed_lead(target_lead_id uuid)
returns table(lead_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  human_lead_id text;
begin
  select lead_id into human_lead_id
  from public.leads
  where id = target_lead_id and deleted_at is not null;

  if human_lead_id is null then
    return;
  end if;

  return query
  update public.leads as lead
  set deleted_at = null,
      deleted_by = null,
      purge_after = null,
      updated_at = clock_timestamp()
  where lead.id = target_lead_id
    and lead.deleted_at is not null
    and lead.purge_after > clock_timestamp()
  returning lead.lead_id;
end;
$$;

create or replace function public.crm_purge_trashed_lead(target_lead_id uuid)
returns table(lead_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  human_lead_id text;
begin
  select lead_id into human_lead_id
  from public.leads
  where id = target_lead_id and deleted_at is not null;

  if human_lead_id is null then
    return;
  end if;

  -- Remove set-null records that may contain copied patient content. Tables
  -- whose foreign keys use ON DELETE CASCADE are removed with the lead below.
  delete from public.crm_ingest_logs where lead_id = target_lead_id;
  delete from public.crm_email_log where lead_id = target_lead_id;
  delete from public.audit_red_flag_conversations where lead_id = target_lead_id;
  delete from public.old_database_followups
    where lead_id = target_lead_id or converted_lead_id = target_lead_id;
  delete from public.audit_logs
  where (entity_type = 'lead' and entity_id::text = target_lead_id::text)
     or metadata ->> 'lead_id' in (target_lead_id::text, human_lead_id)
     or metadata ->> 'leadId' in (target_lead_id::text, human_lead_id)
     or old_values ->> 'lead_id' in (target_lead_id::text, human_lead_id)
     or old_values ->> 'leadId' in (target_lead_id::text, human_lead_id)
     or new_values ->> 'lead_id' in (target_lead_id::text, human_lead_id)
     or new_values ->> 'leadId' in (target_lead_id::text, human_lead_id);

  return query
  delete from public.leads as lead
  where lead.id = target_lead_id
    and lead.deleted_at is not null
  returning lead.lead_id;
end;
$$;

create or replace function public.crm_dashboard_metrics()
returns jsonb
language sql
stable
set search_path = public, extensions
as $$
  with lead_metrics as (
    select
      count(*) filter (where status = 'new_lead') as new_leads,
      count(*) filter (where has_unread) as unread,
      count(*) filter (where is_reply_overdue) as overdue,
      count(*) filter (where status = 'qualified') as qualified,
      count(*) filter (where status = 'booked') as booked,
      count(*) filter (where status = 'follow_up') as follow_up,
      count(*) filter (where status = 'lost') as lost,
      count(*) filter (where booking_appointment_id is not null) as appointments
    from public.leads
    where merged_into_lead_id is null and deleted_at is null
  ), duplicate_metrics as (
    select count(distinct open_lead_id) as duplicates
    from (
      select flag.lead_id as open_lead_id
      from public.lead_duplicate_flags flag
      join public.leads first_lead on first_lead.id = flag.lead_id and first_lead.deleted_at is null
      join public.leads second_lead on second_lead.id = flag.duplicate_lead_id and second_lead.deleted_at is null
      where flag.status not in ('merged', 'dismissed')
      union
      select flag.duplicate_lead_id
      from public.lead_duplicate_flags flag
      join public.leads first_lead on first_lead.id = flag.lead_id and first_lead.deleted_at is null
      join public.leads second_lead on second_lead.id = flag.duplicate_lead_id and second_lead.deleted_at is null
      where flag.status not in ('merged', 'dismissed')
    ) open_duplicates
  ), escalation_metrics as (
    select count(*) as escalations
    from public.escalations escalation
    join public.leads lead on lead.id = escalation.lead_id and lead.deleted_at is null
    where escalation.status <> 'resolved'
  )
  select jsonb_build_object(
    'newLeads', lead_metrics.new_leads,
    'unread', lead_metrics.unread,
    'overdue', lead_metrics.overdue,
    'qualified', lead_metrics.qualified,
    'booked', lead_metrics.booked,
    'followUp', lead_metrics.follow_up,
    'lost', lead_metrics.lost,
    'appointments', lead_metrics.appointments,
    'duplicates', duplicate_metrics.duplicates,
    'escalations', escalation_metrics.escalations
  )
  from lead_metrics, duplicate_metrics, escalation_metrics;
$$;

create or replace function public.crm_purge_expired_lead_trash()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target uuid;
  purged integer := 0;
begin
  for target in
    select id
    from public.leads
    where deleted_at is not null
      and purge_after <= clock_timestamp()
    order by purge_after
    for update skip locked
  loop
    perform public.crm_purge_trashed_lead(target);
    purged := purged + 1;
  end loop;
  return purged;
end;
$$;

revoke all on function public.crm_trash_lead(uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_restore_trashed_lead(uuid) from public, anon, authenticated;
revoke all on function public.crm_purge_trashed_lead(uuid) from public, anon, authenticated;
revoke all on function public.crm_purge_expired_lead_trash() from public, anon, authenticated;

grant execute on function public.crm_trash_lead(uuid, uuid) to service_role;
grant execute on function public.crm_restore_trashed_lead(uuid) to service_role;
grant execute on function public.crm_purge_trashed_lead(uuid) to service_role;
grant execute on function public.crm_purge_expired_lead_trash() to service_role;
