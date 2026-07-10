-- CRM Instagram DM ingestion support.
-- Instagram scoped user IDs are only unique within the professional/business account,
-- so matching must use instagram_account_id + platform_user_id or conversation_key.

set search_path = public, extensions;


alter table public.leads
  add column if not exists instagram_account_id text;

alter table public.crm_conversations
  add column if not exists instagram_account_id text;

alter table public.lead_source_links
  add column if not exists instagram_account_id text;

alter table public.lead_messages
  add column if not exists instagram_account_id text;

alter table public.crm_messages
  add column if not exists instagram_account_id text;

alter table public.crm_ingest_logs
  add column if not exists instagram_account_id text;

create index if not exists idx_leads_instagram_identity
  on public.leads(platform, instagram_account_id, normalized_platform_id)
  where platform = 'instagram_dm';

create index if not exists idx_crm_conversations_instagram_identity
  on public.crm_conversations(platform, instagram_account_id, normalized_platform_user_id)
  where platform = 'instagram_dm';

create index if not exists idx_crm_messages_instagram_identity
  on public.crm_messages(platform, instagram_account_id, platform_user_id);
