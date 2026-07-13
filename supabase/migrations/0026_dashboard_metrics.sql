-- Collapse the CRM shell's repeated count queries into one indexed database
-- call. This function is read-only and is executed through the service role.

set search_path = public, extensions;

create index if not exists lead_duplicate_flags_open_leads_idx
  on public.lead_duplicate_flags (status, lead_id, duplicate_lead_id)
  where status not in ('merged', 'dismissed');

create index if not exists escalations_open_status_idx
  on public.escalations (status)
  where status <> 'resolved';

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
    where merged_into_lead_id is null
  ), duplicate_metrics as (
    select count(distinct lead_id) as duplicates
    from (
      select lead_id
      from public.lead_duplicate_flags
      where status not in ('merged', 'dismissed')
      union
      select duplicate_lead_id
      from public.lead_duplicate_flags
      where status not in ('merged', 'dismissed')
    ) open_duplicate_leads
  ), escalation_metrics as (
    select count(*) as escalations
    from public.escalations
    where status <> 'resolved'
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

revoke all on function public.crm_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.crm_dashboard_metrics() to service_role;
