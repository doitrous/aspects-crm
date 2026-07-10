-- Direct Facebook Messenger conversation links for CRM lead detail shortcuts.

set search_path = public, extensions;


alter table public.leads add column if not exists conversation_link text;
alter table public.leads add column if not exists fallback_inbox_link text;
alter table public.leads add column if not exists page_inbox_link text;
alter table public.leads add column if not exists conversation_key text;

alter table public.crm_conversations add column if not exists conversation_link text;
alter table public.crm_conversations add column if not exists fallback_inbox_link text;
alter table public.crm_conversations add column if not exists page_inbox_link text;
alter table public.crm_conversations add column if not exists conversation_key text;

alter table public.lead_source_links add column if not exists conversation_link text;
alter table public.lead_source_links add column if not exists fallback_inbox_link text;
alter table public.lead_source_links add column if not exists page_inbox_link text;
alter table public.lead_source_links add column if not exists conversation_key text;

create index if not exists leads_conversation_link_idx
  on public.leads(conversation_link)
  where conversation_link is not null;

create index if not exists crm_conversations_conversation_link_idx
  on public.crm_conversations(conversation_link)
  where conversation_link is not null;
