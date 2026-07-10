-- CRM conversation/message tables for normalized social inbox ingestion.

set search_path = public, extensions;


create table if not exists public.crm_conversations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  source text not null,
  platform text not null,
  platform_user_id text,
  normalized_platform_user_id text,
  conversation_id text,
  chat_link text,
  normalized_chat_link text,
  last_message_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_conversations_lead_id_idx on public.crm_conversations(lead_id);
create index if not exists crm_conversations_platform_user_idx
  on public.crm_conversations(platform, normalized_platform_user_id)
  where normalized_platform_user_id is not null;
create index if not exists crm_conversations_chat_link_idx
  on public.crm_conversations(normalized_chat_link)
  where normalized_chat_link is not null;

create table if not exists public.crm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.crm_conversations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  source text not null,
  platform text not null,
  platform_user_id text,
  direction text not null default 'incoming' check (direction in ('incoming', 'outgoing', 'internal')),
  message_text text,
  message_type text not null default 'text',
  attachment_url text,
  platform_message_id text,
  moderator_notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references public.crm_users(id) on delete set null
);

create index if not exists crm_messages_conversation_id_idx on public.crm_messages(conversation_id);
create index if not exists crm_messages_lead_id_idx on public.crm_messages(lead_id);
create index if not exists crm_messages_platform_user_idx on public.crm_messages(platform, platform_user_id);
create index if not exists crm_messages_message_at_idx on public.crm_messages(message_at);

create or replace function public.crm_prepare_conversation()
returns trigger
language plpgsql
as $$
begin
  new.normalized_platform_user_id := public.crm_normalize_text_identifier(new.platform_user_id);
  new.normalized_chat_link := public.crm_normalize_text_identifier(new.chat_link);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists crm_conversations_prepare on public.crm_conversations;
create trigger crm_conversations_prepare
before insert or update on public.crm_conversations
for each row execute function public.crm_prepare_conversation();

grant select, insert, update, delete on public.crm_conversations to service_role;
grant select, insert, update, delete on public.crm_messages to service_role;
