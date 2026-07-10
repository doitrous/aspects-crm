-- Outgoing Facebook Messenger echoes and message-level ingest diagnostics.

set search_path = public, extensions;


alter table public.crm_conversations add column if not exists last_outgoing_at timestamptz;

alter table public.crm_messages add column if not exists conversation_key text;
alter table public.crm_messages add column if not exists is_echo boolean not null default false;
alter table public.crm_messages add column if not exists sent_by_type text;
alter table public.crm_messages add column if not exists sent_by_name text;
alter table public.crm_messages add column if not exists facebook_app_id text;

create index if not exists crm_messages_platform_message_idx
  on public.crm_messages(platform, platform_message_id)
  where platform_message_id is not null;

create index if not exists crm_messages_fallback_dedupe_idx
  on public.crm_messages(conversation_key, direction, message_text, message_at)
  where platform_message_id is null and conversation_key is not null and message_text is not null;

create index if not exists crm_messages_conversation_key_idx
  on public.crm_messages(conversation_key)
  where conversation_key is not null;

alter table public.lead_messages add column if not exists is_echo boolean not null default false;
alter table public.lead_messages add column if not exists sent_by_type text;
alter table public.lead_messages add column if not exists sent_by_name text;
alter table public.lead_messages add column if not exists facebook_app_id text;

create index if not exists lead_messages_platform_message_idx
  on public.lead_messages(platform, platform_message_id)
  where platform_message_id is not null;

alter table public.crm_ingest_logs add column if not exists direction text;
alter table public.crm_ingest_logs add column if not exists platform_message_id text;
alter table public.crm_ingest_logs add column if not exists message_id uuid references public.crm_messages(id) on delete set null;

create index if not exists crm_ingest_logs_platform_message_idx
  on public.crm_ingest_logs(platform, platform_message_id)
  where platform_message_id is not null;
