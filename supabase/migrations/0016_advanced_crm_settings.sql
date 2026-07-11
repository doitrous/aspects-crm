-- Advanced CRM settings. Additive only; all financial records continue to use
-- the canonical tables created by 0002/0014.

create table if not exists public.crm_staff_commission_rules (
  id uuid primary key default gen_random_uuid(),
  moderator_id uuid references public.crm_users(id) on delete cascade,
  doctor_id uuid,
  service_id uuid,
  service_name text,
  specialty_id uuid,
  commission_pct numeric(5,2) not null check (commission_pct between 0 and 100),
  active boolean not null default true,
  effective_from date,
  effective_to date,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_staff_commission_lookup_idx
  on public.crm_staff_commission_rules (moderator_id, doctor_id, service_id, specialty_id)
  where active;

create table if not exists public.crm_financial_bundles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specialty_id uuid,
  specialty_name text,
  bundle_type text not null check (bundle_type in ('bundle','package','addon')),
  price numeric(14,2) not null check (price >= 0),
  currency text not null default 'EGP',
  active boolean not null default true,
  starts_on date,
  expires_on date,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_financial_bundles_specialty_idx
  on public.crm_financial_bundles (specialty_id, active, expires_on);

create table if not exists public.crm_financial_bundle_components (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references public.crm_financial_bundles(id) on delete cascade,
  service_id uuid,
  service_name text not null,
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists crm_fin_bundle_components_bundle_idx
  on public.crm_financial_bundle_components (bundle_id, display_order);

create table if not exists public.crm_service_addon_rules (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid references public.crm_financial_bundles(id) on delete cascade,
  trigger_service_id uuid,
  trigger_service_name text not null,
  addon_service_id uuid,
  addon_service_name text not null,
  addon_price numeric(14,2) not null check (addon_price >= 0),
  redeem_within_days integer not null default 10 check (redeem_within_days >= 0),
  anchor text not null default 'procedure_date' check (anchor = 'procedure_date'),
  active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_service_addon_lookup_idx
  on public.crm_service_addon_rules (trigger_service_id, active);

create table if not exists public.crm_payment_method_settings (
  id uuid primary key default gen_random_uuid(),
  method_key text not null unique,
  display_name text not null,
  ledger_method crm_payment_method not null default 'other',
  display_order integer not null default 0,
  active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.crm_payment_method_settings (method_key, display_name, ledger_method, display_order)
values
  ('cash','Cash','cash',10), ('visa','Visa','visa',20),
  ('instapay','InstaPay','instapay',30), ('mobile_wallet','Mobile wallet','mobile_wallet',40),
  ('bank_transfer','Bank transfer','bank_transfer',50), ('other','Other','other',60)
on conflict (method_key) do nothing;

create table if not exists public.crm_report_field_settings (
  id uuid primary key default gen_random_uuid(),
  report_key text not null,
  field_key text not null,
  label text not null,
  visible boolean not null default true,
  display_order integer not null default 0,
  updated_by uuid references public.crm_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (report_key, field_key)
);

create table if not exists public.crm_user_session_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.crm_users(id) on delete set null,
  auth_user_id uuid,
  event_type text not null check (event_type in ('login','logout')),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists crm_user_session_events_user_time_idx
  on public.crm_user_session_events (user_id, occurred_at desc);

insert into public.lost_reasons (label, is_active, display_order)
select 'Other', true, 999
where not exists (select 1 from public.lost_reasons where lower(label) = 'other');

do $$
declare t text;
begin
  foreach t in array array[
    'crm_staff_commission_rules','crm_financial_bundles',
    'crm_financial_bundle_components','crm_service_addon_rules',
    'crm_payment_method_settings','crm_report_field_settings','crm_user_session_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

drop trigger if exists trg_crm_staff_commission_updated on public.crm_staff_commission_rules;
create trigger trg_crm_staff_commission_updated before update on public.crm_staff_commission_rules
  for each row execute function crm_fin_set_updated_at();
drop trigger if exists trg_crm_financial_bundles_updated on public.crm_financial_bundles;
create trigger trg_crm_financial_bundles_updated before update on public.crm_financial_bundles
  for each row execute function crm_fin_set_updated_at();
drop trigger if exists trg_crm_service_addon_updated on public.crm_service_addon_rules;
create trigger trg_crm_service_addon_updated before update on public.crm_service_addon_rules
  for each row execute function crm_fin_set_updated_at();
drop trigger if exists trg_crm_payment_method_updated on public.crm_payment_method_settings;
create trigger trg_crm_payment_method_updated before update on public.crm_payment_method_settings
  for each row execute function crm_fin_set_updated_at();
