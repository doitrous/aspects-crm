-- Database imports are canonical patient records, not newly acquired leads.
-- Their schema status remains `new_lead` until a moderator chooses a real
-- workflow stage, but the New Leads KPI must not count that storage default.

set search_path = public, extensions;

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
  ), duplicate_metrics as (
    select count(distinct lead_id) as duplicates from (
      select lead_id from public.lead_duplicate_flags where status not in ('linked','merged','dismissed')
      union select duplicate_lead_id from public.lead_duplicate_flags where status not in ('linked','merged','dismissed')
    ) d
  ), escalation_metrics as (
    select count(*) as escalations from public.escalations where status <> 'resolved'
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
