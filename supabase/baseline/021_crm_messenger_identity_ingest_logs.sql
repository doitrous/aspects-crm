-- Facebook Messenger identity fields and CRM ingest debugging.

set search_path = public, extensions;


alter table public.leads add column if not exists page_id text;
alter table public.leads add column if not exists conversation_key text;
alter table public.leads add column if not exists page_inbox_link text;

create index if not exists leads_messenger_identity_idx
  on public.leads(platform, page_id, normalized_platform_id)
  where platform = 'facebook_messenger' and normalized_platform_id is not null;

create index if not exists leads_conversation_key_idx
  on public.leads(conversation_key)
  where conversation_key is not null;

alter table public.crm_conversations add column if not exists page_id text;
alter table public.crm_conversations add column if not exists conversation_key text;
alter table public.crm_conversations add column if not exists page_inbox_link text;

create unique index if not exists crm_conversations_conversation_key_unique
  on public.crm_conversations(conversation_key)
  where conversation_key is not null;

create index if not exists crm_conversations_messenger_identity_idx
  on public.crm_conversations(platform, page_id, normalized_platform_user_id)
  where platform = 'facebook_messenger' and normalized_platform_user_id is not null;

alter table public.lead_source_links add column if not exists page_id text;
alter table public.lead_source_links add column if not exists conversation_key text;
alter table public.lead_source_links add column if not exists page_inbox_link text;

create index if not exists lead_source_links_messenger_identity_idx
  on public.lead_source_links(platform, page_id, normalized_platform_id)
  where platform = 'facebook_messenger' and normalized_platform_id is not null;

create table if not exists public.crm_ingest_logs (
  id uuid primary key default gen_random_uuid(),
  source text,
  platform text,
  page_id text,
  platform_user_id text,
  conversation_key text,
  message_text text,
  created boolean not null default false,
  updated boolean not null default false,
  lead_id uuid references public.leads(id) on delete set null,
  match_reason text,
  errors jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_ingest_logs_created_at_idx on public.crm_ingest_logs(created_at desc);
create index if not exists crm_ingest_logs_platform_user_idx on public.crm_ingest_logs(platform, page_id, platform_user_id);
create index if not exists crm_ingest_logs_conversation_key_idx on public.crm_ingest_logs(conversation_key);

grant select, insert, update, delete on public.crm_ingest_logs to service_role;
