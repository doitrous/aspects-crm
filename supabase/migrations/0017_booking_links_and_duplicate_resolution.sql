-- Preserve every appointment linked to a lead and make duplicate status choice transactional.

set search_path = public, extensions;

create table if not exists public.crm_lead_booking_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  appointment_id uuid not null,
  linked_by uuid references public.crm_users(id) on delete set null,
  source text not null default 'crm',
  created_at timestamptz not null default now(),
  unique (appointment_id)
);

create index if not exists crm_lead_booking_links_lead_created_idx
  on public.crm_lead_booking_links (lead_id, created_at desc);

insert into public.crm_lead_booking_links (lead_id, appointment_id, source)
select id, booking_appointment_id, 'legacy'
from public.leads
where booking_appointment_id is not null
on conflict (appointment_id) do nothing;

alter table public.crm_lead_booking_links enable row level security;

drop policy if exists "CRM active users can read" on public.crm_lead_booking_links;
create policy "CRM active users can read" on public.crm_lead_booking_links
  for select to authenticated using (public.crm_has_active_user());

grant select on public.crm_lead_booking_links to authenticated;
grant all on public.crm_lead_booking_links to service_role;

create or replace function public.crm_merge_duplicate_flag_with_status(
  target_flag_id uuid,
  actor_id uuid,
  merge_note text default null,
  keep_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  result jsonb;
  survivor_id uuid;
  duplicate_id uuid;
  old_status text;
  redundant_flag_ids uuid[];
begin
  if keep_status is not null and keep_status not in (
    'new_lead', 'qualified', 'booked', 'follow_up', 'post_op_follow_up', 'lost'
  ) then
    raise exception 'Invalid lead status selected for merge';
  end if;

  select lead_id, duplicate_lead_id
    into survivor_id, duplicate_id
    from public.lead_duplicate_flags
   where id = target_flag_id
   for update;
  if survivor_id is null or duplicate_id is null then
    raise exception 'Duplicate flag % not found', target_flag_id;
  end if;

  -- The legacy merge function rewrites every remaining flag from the duplicate
  -- to the survivor. Remove only redundant detection artifacts that would become
  -- self-pairs or violate the pair uniqueness constraint. Preserve their exact
  -- rows in the global immutable audit sink before deletion.
  select array_agg(f.id) into redundant_flag_ids
  from public.lead_duplicate_flags f
  where f.id <> target_flag_id
    and (
      (f.lead_id = duplicate_id and f.duplicate_lead_id = survivor_id)
      or (f.lead_id = survivor_id and f.duplicate_lead_id = duplicate_id)
      or (
        f.lead_id = duplicate_id and exists (
          select 1 from public.lead_duplicate_flags e
          where e.id <> f.id
            and e.lead_id = survivor_id
            and e.duplicate_lead_id = f.duplicate_lead_id
            and e.duplicate_type = f.duplicate_type
            and e.identifier_value = f.identifier_value
        )
      )
      or (
        f.duplicate_lead_id = duplicate_id and exists (
          select 1 from public.lead_duplicate_flags e
          where e.id <> f.id
            and e.duplicate_lead_id = survivor_id
            and e.lead_id = f.lead_id
            and e.duplicate_type = f.duplicate_type
            and e.identifier_value = f.identifier_value
        )
      )
    );

  if coalesce(array_length(redundant_flag_ids, 1), 0) > 0 then
    insert into public.audit_logs (actor_user_id, action, entity_type, entity_id, old_values, new_values, metadata)
    values (
      actor_id,
      'lead.duplicate_flags_consolidated',
      'lead',
      survivor_id,
      jsonb_build_object('duplicate_flag_ids', redundant_flag_ids),
      jsonb_build_object('kept_duplicate_flag_id', target_flag_id),
      jsonb_build_object('reason', 'Prevented duplicate/self flag constraints during merge')
    );
    delete from public.lead_duplicate_flags where id = any(redundant_flag_ids);
  end if;

  result := public.crm_merge_duplicate_flag(target_flag_id, actor_id, merge_note);
  survivor_id := nullif(result->>'primary_uuid', '')::uuid;
  duplicate_id := nullif(result->>'duplicate_uuid', '')::uuid;

  if survivor_id is not null and duplicate_id is not null then
    update public.crm_lead_booking_links
       set lead_id = survivor_id
     where lead_id = duplicate_id;
  end if;

  if survivor_id is not null and keep_status is not null then
    select status::text into old_status from public.leads where id = survivor_id for update;
    execute 'update public.leads set status = $1::crm_lead_status, updated_at = now() where id = $2'
      using keep_status, survivor_id;

    update public.lead_status_history
       set changed_by = actor_id,
           notes = 'Status selected during duplicate merge'
     where id = (
       select id from public.lead_status_history
       where lead_id = survivor_id and to_status::text = keep_status
       order by created_at desc limit 1
     );
  end if;

  return result || jsonb_build_object('kept_status', keep_status);
end;
$$;

grant execute on function public.crm_merge_duplicate_flag_with_status(uuid, uuid, text, text) to service_role;
