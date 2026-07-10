-- CRM social comments capture for Instagram/Facebook comments and page replies.

set search_path = public, extensions;


create table if not exists public.crm_comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  conversation_id uuid references public.crm_conversations(id) on delete set null,
  source text not null,
  platform text not null,
  page_id text,
  instagram_account_id text,
  platform_user_id text,
  commenter_id text,
  commenter_username text,
  commenter_name text,
  conversation_key text,
  comment_thread_key text,
  comment_id text,
  parent_comment_id text,
  post_id text,
  media_id text,
  comment_text text,
  comment_timestamp timestamptz not null default now(),
  direction text not null default 'incoming',
  is_page_or_business_reply boolean not null default false,
  message_type text not null default 'comment',
  comment_type text,
  facebook_verb text,
  media_permalink text,
  media_caption text,
  comment_link text,
  fallback_inbox_link text,
  attachment_url text,
  campaign text,
  ad_name text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.crm_ingest_logs
  add column if not exists record_type text,
  add column if not exists comment_id text,
  add column if not exists comment_thread_key text;

create unique index if not exists idx_crm_comments_platform_comment_id
  on public.crm_comments(platform, comment_id)
  where comment_id is not null;

create unique index if not exists idx_crm_comments_fallback_dedupe
  on public.crm_comments(comment_thread_key, direction, comment_text, comment_timestamp)
  where comment_id is null and comment_thread_key is not null;

create index if not exists idx_crm_comments_lead_id on public.crm_comments(lead_id);
create index if not exists idx_crm_comments_platform_user on public.crm_comments(platform, platform_user_id);
create index if not exists idx_crm_comments_thread on public.crm_comments(comment_thread_key);
create index if not exists idx_crm_comments_text on public.crm_comments using gin(to_tsvector('simple', coalesce(comment_text, '')));
