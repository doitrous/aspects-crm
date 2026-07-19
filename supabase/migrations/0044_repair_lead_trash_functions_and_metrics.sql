-- Forward repair for migration 0043.
--
-- 1. Qualify every lead_id column used inside functions whose RETURNS TABLE
--    output is also named lead_id. PostgreSQL exposes that output name as a
--    PL/pgSQL variable, so an unqualified column reference is ambiguous at
--    runtime.
-- 2. Restore the operational/database-only filters that migration 0035 added
--    to crm_dashboard_metrics() while retaining 0043's deleted-lead filters.
--
-- This migration replaces functions only; it does not mutate lead data.
-- Rollback: stop the purge scheduler and replace these functions with an
-- approved corrected definition. Reapplying 0043 verbatim is not a safe
-- rollback because it restores both defects fixed here.

set search_path = public, extensions;

create or replace function public.crm_restore_trashed_lead(target_lead_id uuid)
returns table(lead_id text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  human_lead_id text;
begin
  select trashed_lead.lead_id into human_lead_id
  from public.leads as trashed_lead
  where trashed_lead.id = target_lead_id
    and trashed_lead.deleted_at is not null;

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
  select trashed_lead.lead_id into human_lead_id
  from public.leads as trashed_lead
  where trashed_lead.id = target_lead_id
    and trashed_lead.deleted_at is not null;

  if human_lead_id is null then
    return;
  end if;

  -- Remove set-null records that may contain copied patient content. Tables
  -- whose foreign keys use ON DELETE CASCADE are removed with the lead below.
  delete from public.crm_ingest_logs as ingest_log
  where ingest_log.lead_id = target_lead_id;

  delete from public.crm_email_log as email_log
  where email_log.lead_id = target_lead_id;

  delete from public.audit_red_flag_conversations as red_flag
  where red_flag.lead_id = target_lead_id;

  delete from public.old_database_followups as legacy_followup
  where legacy_followup.lead_id = target_lead_id
     or legacy_followup.converted_lead_id = target_lead_id;

  delete from public.audit_logs as audit_log
  where (audit_log.entity_type = 'lead' and audit_log.entity_id::text = target_lead_id::text)
     or audit_log.metadata ->> 'lead_id' in (target_lead_id::text, human_lead_id)
     or audit_log.metadata ->> 'leadId' in (target_lead_id::text, human_lead_id)
     or audit_log.old_values ->> 'lead_id' in (target_lead_id::text, human_lead_id)
     or audit_log.old_values ->> 'leadId' in (target_lead_id::text, human_lead_id)
     or audit_log.new_values ->> 'lead_id' in (target_lead_id::text, human_lead_id)
     or audit_log.new_values ->> 'leadId' in (target_lead_id::text, human_lead_id);

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
      count(*) filter (
        where lead.status = 'new_lead'
          and lead.metadata->>'record_source' is distinct from 'database'
      ) as new_leads,
      count(*) filter (where lead.has_unread) as unread,
      count(*) filter (where lead.is_reply_overdue) as overdue,
      count(*) filter (where lead.status = 'qualified') as qualified,
      count(*) filter (where lead.status = 'booked') as booked,
      count(*) filter (where lead.status = 'follow_up') as follow_up,
      count(*) filter (where lead.status = 'lost') as lost,
      count(*) filter (where lead.booking_appointment_id is not null) as appointments
    from public.leads as lead
    where lead.merged_into_lead_id is null
      and lead.deleted_at is null
      and coalesce(lead.metadata->>'database_only', 'false') <> 'true'
  ), duplicate_metrics as (
    select count(distinct open_duplicate.open_lead_id) as duplicates
    from (
      select flag.lead_id as open_lead_id
      from public.lead_duplicate_flags as flag
      join public.leads as first_lead
        on first_lead.id = flag.lead_id
       and first_lead.deleted_at is null
       and first_lead.merged_into_lead_id is null
       and coalesce(first_lead.metadata->>'database_only', 'false') <> 'true'
      join public.leads as second_lead
        on second_lead.id = flag.duplicate_lead_id
       and second_lead.deleted_at is null
       and second_lead.merged_into_lead_id is null
       and coalesce(second_lead.metadata->>'database_only', 'false') <> 'true'
      where flag.status not in ('linked', 'merged', 'dismissed')

      union

      select flag.duplicate_lead_id
      from public.lead_duplicate_flags as flag
      join public.leads as first_lead
        on first_lead.id = flag.lead_id
       and first_lead.deleted_at is null
       and first_lead.merged_into_lead_id is null
       and coalesce(first_lead.metadata->>'database_only', 'false') <> 'true'
      join public.leads as second_lead
        on second_lead.id = flag.duplicate_lead_id
       and second_lead.deleted_at is null
       and second_lead.merged_into_lead_id is null
       and coalesce(second_lead.metadata->>'database_only', 'false') <> 'true'
      where flag.status not in ('linked', 'merged', 'dismissed')
    ) as open_duplicate
  ), escalation_metrics as (
    select count(*) as escalations
    from public.escalations as escalation
    join public.leads as lead
      on lead.id = escalation.lead_id
     and lead.deleted_at is null
     and lead.merged_into_lead_id is null
     and coalesce(lead.metadata->>'database_only', 'false') <> 'true'
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

revoke all on function public.crm_restore_trashed_lead(uuid) from public, anon, authenticated;
revoke all on function public.crm_purge_trashed_lead(uuid) from public, anon, authenticated;
revoke all on function public.crm_dashboard_metrics() from public, anon, authenticated;

grant execute on function public.crm_restore_trashed_lead(uuid) to service_role;
grant execute on function public.crm_purge_trashed_lead(uuid) to service_role;
grant execute on function public.crm_dashboard_metrics() to service_role;
