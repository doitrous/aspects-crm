-- Keep passive historical patients in Database until a new reservation makes
-- them operational again. Also seed the canonical source and system tag.

set search_path = public, extensions;

insert into public.lead_sources (key, label, source_type, display_order)
values ('database', 'Database', 'database', 50)
on conflict (key) do update set
  label = excluded.label,
  source_type = excluded.source_type,
  display_order = excluded.display_order,
  updated_at = now();

insert into public.lead_tags (name, color)
values ('Revisiting Patient', '#7c3aed')
on conflict (name) do update set color = excluded.color, updated_at = now();

update public.leads
set source_id = (select id from public.lead_sources where key = 'database'),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('record_source', 'database'),
    updated_at = now()
where metadata->>'imported_via' = 'patient_bulk_import'
  and metadata->>'bulk_merged_by' is null;

create index if not exists leads_record_source_pipeline_idx
  on public.leads ((metadata->>'record_source'), (metadata->>'revisiting_patient'), status)
  where merged_into_lead_id is null;

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
      and (
        metadata->>'record_source' is distinct from 'database'
        or metadata->>'revisiting_patient' = 'true'
      )
  ), duplicate_metrics as (
    select count(distinct lead_id) as duplicates
    from (
      select lead_id from public.lead_duplicate_flags where status not in ('linked', 'merged', 'dismissed')
      union
      select duplicate_lead_id from public.lead_duplicate_flags where status not in ('linked', 'merged', 'dismissed')
    ) open_duplicate_leads
  ), escalation_metrics as (
    select count(*) as escalations from public.escalations where status <> 'resolved'
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
