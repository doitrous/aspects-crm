-- CRM integrations registry for OAuth connections such as Instagram Business Login.

set search_path = public, extensions;


create table if not exists public.crm_integrations (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  account_id text,
  account_name text,
  access_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'connected',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, account_id)
);

create index if not exists idx_crm_integrations_provider on public.crm_integrations(provider);
create index if not exists idx_crm_integrations_status on public.crm_integrations(status);
