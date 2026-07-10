-- 0011_crm_performance_indexes.sql
-- Performance hardening for the production CRM lead list and lazy drawer tabs.

create extension if not exists pg_trgm;

-- Lead list default order and common filtered pages.
create index if not exists leads_updated_at_idx
  on public.leads (updated_at desc);

create index if not exists leads_status_updated_at_idx
  on public.leads (status, updated_at desc);

create index if not exists leads_platform_updated_at_idx
  on public.leads (platform, updated_at desc);

create index if not exists leads_source_updated_at_idx
  on public.leads (source_id, updated_at desc)
  where source_id is not null;

create index if not exists leads_doctor_updated_at_idx
  on public.leads (doctor_id, updated_at desc)
  where doctor_id is not null;

create index if not exists leads_unread_updated_at_idx
  on public.leads (updated_at desc)
  where has_unread = true;

create index if not exists leads_reply_overdue_updated_at_idx
  on public.leads (updated_at desc)
  where is_reply_overdue = true;

create index if not exists leads_escalated_updated_at_idx
  on public.leads (updated_at desc)
  where escalation_status in ('escalated', 'in_review');

-- User-facing search by lead id, MRN, name, phone fragments, chat link, and platform id.
create index if not exists leads_lead_id_trgm_idx
  on public.leads using gin (lead_id gin_trgm_ops);

create index if not exists leads_mrn_trgm_idx
  on public.leads using gin (mrn gin_trgm_ops)
  where mrn is not null;

create index if not exists leads_name_trgm_idx
  on public.leads using gin (name gin_trgm_ops)
  where name is not null;

create index if not exists leads_normalized_phone_trgm_idx
  on public.leads using gin (normalized_phone gin_trgm_ops)
  where normalized_phone is not null;

create index if not exists leads_phone_number_trgm_idx
  on public.leads using gin (phone_number gin_trgm_ops)
  where phone_number is not null;

create index if not exists leads_platform_id_trgm_idx
  on public.leads using gin (platform_id gin_trgm_ops)
  where platform_id is not null;

create index if not exists leads_chat_link_trgm_idx
  on public.leads using gin (chat_link gin_trgm_ops)
  where chat_link is not null;

-- Lazy drawer tabs: fetch histories for one lead in display order.
create index if not exists lead_timeline_events_lead_event_at_idx
  on public.lead_timeline_events (lead_id, event_at desc);

create index if not exists audit_logs_entity_created_at_idx
  on public.audit_logs (entity_type, entity_id, created_at desc)
  where entity_id is not null;

create index if not exists lead_follow_up_stages_open_idx
  on public.lead_follow_up_stages (lead_id, due_at asc)
  where status <> 'completed';
