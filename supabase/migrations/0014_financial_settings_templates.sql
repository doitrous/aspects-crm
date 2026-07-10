-- Financial Settings completion.
-- Adds only missing template tables; existing canonical financial tables remain
-- the source of truth for prices, discounts, compensation, lead costs, ledger,
-- exceptional approvals, and audit.

alter table public.crm_financial_service_settings
  add column if not exists effective_from date,
  add column if not exists effective_to date;

create index if not exists crm_fin_service_settings_service_active_idx
  on public.crm_financial_service_settings (service_id, active, effective_from desc);

create table if not exists public.crm_service_consumable_defaults (
  id uuid primary key default gen_random_uuid(),
  service_settings_id uuid references public.crm_financial_service_settings(id) on delete cascade,
  service_id uuid,
  service_name text not null,
  component_id uuid references public.crm_consumable_components(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1,
  unit_cost numeric(14,2) not null default 0,
  total_cost numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_service_consumable_defaults_service_idx
  on public.crm_service_consumable_defaults (service_id, service_name, active);

drop trigger if exists trg_crm_service_consumable_defaults_updated on public.crm_service_consumable_defaults;
create trigger trg_crm_service_consumable_defaults_updated
  before update on public.crm_service_consumable_defaults
  for each row execute function public.crm_fin_set_updated_at();

create table if not exists public.crm_service_external_cost_defaults (
  id uuid primary key default gen_random_uuid(),
  service_settings_id uuid references public.crm_financial_service_settings(id) on delete cascade,
  service_id uuid,
  service_name text not null,
  category public.crm_external_cost_category not null default 'other',
  description text not null,
  amount numeric(14,2) not null default 0,
  vendor text,
  active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_service_external_cost_defaults_service_idx
  on public.crm_service_external_cost_defaults (service_id, service_name, active);

drop trigger if exists trg_crm_service_external_cost_defaults_updated on public.crm_service_external_cost_defaults;
create trigger trg_crm_service_external_cost_defaults_updated
  before update on public.crm_service_external_cost_defaults
  for each row execute function public.crm_fin_set_updated_at();

alter table public.crm_service_consumable_defaults enable row level security;
alter table public.crm_service_external_cost_defaults enable row level security;
