-- Database is the permanent patient source of truth. A database-only workflow
-- state removes a lead from operational queues without deleting or nulling the
-- schema-required status. Relationship links now preserve richer family types.

set search_path = public, extensions;

alter table public.crm_lead_links
  drop constraint if exists crm_lead_links_relationship_check;

update public.crm_lead_links
set relationship = 'relative'
where relationship = 'family';

alter table public.crm_lead_links
  add constraint crm_lead_links_relationship_check
  check (relationship in ('same_patient', 'relative', 'distant_relative', 'other'));

create index if not exists leads_database_only_idx
  on public.leads ((coalesce(metadata->>'database_only', 'false')), status)
  where merged_into_lead_id is null;

create or replace function public.crm_dashboard_metrics()
returns jsonb language sql stable set search_path = public, extensions as $$
  with lead_metrics as (
    select
      count(*) filter (
        where status = 'new_lead'
          and metadata->>'record_source' is distinct from 'database'
      ) as new_leads,
      count(*) filter (where has_unread) as unread,
      count(*) filter (where is_reply_overdue) as overdue,
      count(*) filter (where status = 'qualified') as qualified,
      count(*) filter (where status = 'booked') as booked,
      count(*) filter (where status = 'follow_up') as follow_up,
      count(*) filter (where status = 'lost') as lost,
      count(*) filter (where booking_appointment_id is not null) as appointments
    from public.leads
    where merged_into_lead_id is null
      and coalesce(metadata->>'database_only', 'false') <> 'true'
  ), duplicate_metrics as (
    select count(distinct d.lead_id) as duplicates from (
      select lead_id from public.lead_duplicate_flags where status not in ('linked','merged','dismissed')
      union select duplicate_lead_id from public.lead_duplicate_flags where status not in ('linked','merged','dismissed')
    ) d
    join public.leads l on l.id = d.lead_id
    where l.merged_into_lead_id is null
      and coalesce(l.metadata->>'database_only', 'false') <> 'true'
  ), escalation_metrics as (
    select count(*) as escalations
    from public.escalations e
    join public.leads l on l.id = e.lead_id
    where e.status <> 'resolved'
      and l.merged_into_lead_id is null
      and coalesce(l.metadata->>'database_only', 'false') <> 'true'
  )
  select jsonb_build_object(
    'newLeads', new_leads,
    'unread', unread,
    'overdue', overdue,
    'qualified', qualified,
    'booked', booked,
    'followUp', follow_up,
    'lost', lost,
    'appointments', appointments,
    'duplicates', duplicates,
    'escalations', escalations
  )
  from lead_metrics, duplicate_metrics, escalation_metrics;
$$;

revoke all on function public.crm_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.crm_dashboard_metrics() to service_role;
