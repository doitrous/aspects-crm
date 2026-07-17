-- Meta can deliver outgoing echoes and receipts before an identifiable patient
-- message creates a lead. The ingestion model already supports these records
-- with a null lead_id and backfills the lead when identity becomes available.
-- Relaxing these two legacy constraints prevents valid webhook events from
-- failing without creating fake patient leads or changing existing rows.

alter table public.crm_conversations alter column lead_id drop not null;
alter table public.crm_messages alter column lead_id drop not null;

create index if not exists crm_conversations_unmatched_identity_idx
  on public.crm_conversations (platform, platform_user_id, created_at desc)
  where lead_id is null;

create index if not exists crm_messages_unmatched_identity_idx
  on public.crm_messages (platform, platform_user_id, message_at desc)
  where lead_id is null;
