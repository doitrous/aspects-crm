-- ============================================================================
-- 0002_financial_source_of_truth.sql
--
-- Financial Source of Truth (spec §1–§16). Additive and idempotent: it only
-- CREATEs new objects with IF NOT EXISTS / guarded DO blocks and never alters or
-- drops anything in the existing 55-table schema. Safe to run more than once.
--
-- HOW TO APPLY (no DDL access from the app): open the CRM Supabase project
-- (ref wgczgrhcqishvhbitvml) → SQL Editor → paste this whole file → Run.
--
-- Reconciliation notes vs the live schema:
--  * The CRM has NO local services or doctors tables — a service is
--    leads.service_name (text) + leads.booking_service_id (uuid, booking side),
--    and a doctor is leads.doctor_id (uuid, booking side). So service/doctor
--    references below are SOFT (uuid/text columns, no FK to a missing table).
--  * Discount approvals reuse the existing `escalations` table (§4) via
--    escalation_id, rather than inventing a parallel escalation system.
--  * Money is numeric(14,2); the app's decimal-safe engine (lib/financial) is
--    the single source of truth for DERIVED figures — these columns store only
--    entered/frozen values and append-only ledger lines.
--
-- RLS: every table has RLS ENABLED with no permissive policy, so the anon/auth
-- keys cannot read or write them. The server (service-role key) bypasses RLS,
-- which is how the app writes today. Per-role policies land with real auth.
-- ============================================================================

-- ── enums (guarded) ─────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_transaction_kind') then
    create type crm_transaction_kind as enum
      ('payment','refund','reversal','chargeback','credit_note','doctor_funded');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_payment_method') then
    create type crm_payment_method as enum
      ('cash','visa','instapay','mobile_wallet','bank_transfer','other');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_compensation_kind') then
    create type crm_compensation_kind as enum ('percentage','fixed');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_compensation_basis') then
    create type crm_compensation_basis as enum ('quoted_price','net_after_consumables');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_discount_scope') then
    create type crm_discount_scope as enum ('moderator_service','moderator','service','global');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_discount_approval_status') then
    create type crm_discount_approval_status as enum ('pending','approved','rejected','resolved');
  end if;
  if not exists (select 1 from pg_type where typname = 'crm_external_cost_category') then
    create type crm_external_cost_category as enum
      ('lab','outside_facility','external_surgeon','anesthetist','imaging','referral_commission','other');
  end if;
end $$;

-- ── shared updated_at trigger fn (idempotent) ───────────────────────────────
create or replace function crm_fin_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

-- ── §2 independent CRM service pricing (current, editable) ──────────────────
create table if not exists crm_financial_service_settings (
  id                      uuid primary key default gen_random_uuid(),
  service_id              uuid,                 -- soft ref to booking service (nullable)
  service_name            text not null,
  base_price              numeric(14,2) not null default 0,
  default_consumables_cost numeric(14,2) not null default 0,
  currency                text not null default 'EGP',
  active                  boolean not null default true,
  created_by              uuid references crm_users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index if not exists crm_fin_service_settings_name_uq
  on crm_financial_service_settings (lower(service_name)) where active;
drop trigger if exists trg_crm_fin_service_settings_updated on crm_financial_service_settings;
create trigger trg_crm_fin_service_settings_updated before update on crm_financial_service_settings
  for each row execute function crm_fin_set_updated_at();

-- ── §3 hierarchical discount rules ──────────────────────────────────────────
create table if not exists crm_discount_rules (
  id                uuid primary key default gen_random_uuid(),
  scope             crm_discount_scope not null,
  moderator_id      uuid references crm_users(id) on delete cascade,   -- for moderator[/_service]
  service_id        uuid,                                              -- soft ref
  service_name      text,                                              -- for service[/moderator_service]
  max_discount_pct  numeric(5,2) not null default 0 check (max_discount_pct >= 0 and max_discount_pct <= 100),
  active            boolean not null default true,
  effective_from    date,
  effective_to      date,
  created_by        uuid references crm_users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists crm_discount_rules_lookup
  on crm_discount_rules (scope, moderator_id, service_id) where active;
drop trigger if exists trg_crm_discount_rules_updated on crm_discount_rules;
create trigger trg_crm_discount_rules_updated before update on crm_discount_rules
  for each row execute function crm_fin_set_updated_at();

-- ── §1 per-lead financial record (one per lead) ─────────────────────────────
create table if not exists crm_lead_financials (
  id                     uuid primary key default gen_random_uuid(),
  lead_id                uuid not null references leads(id) on delete cascade,
  service_settings_id    uuid references crm_financial_service_settings(id) on delete set null,
  service_name           text,
  -- Frozen at record creation (§2): the base price the discount is measured against.
  base_service_price     numeric(14,2) not null default 0,
  -- MANUAL agreed price after discount (§1B); null = not yet quoted.
  quoted_price           numeric(14,2),
  max_allowed_discount_pct numeric(5,2) not null default 0,
  -- Exceptional (below-allowed) price override (§1B, §15).
  is_exceptional         boolean not null default false,
  exceptional_reason     text,
  exceptional_by         uuid references crm_users(id) on delete set null,
  exceptional_at         timestamptz,
  -- §10 date basis: profitability reports use the service/procedure date.
  service_date           date,
  currency               text not null default 'EGP',
  financial_notes        text,                                 -- §1J
  created_by             uuid references crm_users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (lead_id)
);
drop trigger if exists trg_crm_lead_financials_updated on crm_lead_financials;
create trigger trg_crm_lead_financials_updated before update on crm_lead_financials
  for each row execute function crm_fin_set_updated_at();

-- ── §1C–E append-only payments / refunds / reversals ledger ─────────────────
create table if not exists crm_financial_transactions (
  id                     uuid primary key default gen_random_uuid(),
  lead_financials_id     uuid not null references crm_lead_financials(id) on delete cascade,
  lead_id                uuid not null references leads(id) on delete cascade,
  kind                   crm_transaction_kind not null,
  amount                 numeric(14,2) not null,               -- positive magnitude
  method                 crm_payment_method,                   -- §1D (multiple methods per bill)
  -- §10 date basis: cash-flow reports use the ACTUAL payment date.
  occurred_on            date not null default current_date,
  reference              text,
  note                   text,
  -- §1E: reversals/refunds reference the original; originals are NEVER deleted.
  reverses_transaction_id uuid references crm_financial_transactions(id) on delete restrict,
  created_by             uuid references crm_users(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index if not exists crm_fin_txn_by_record on crm_financial_transactions (lead_financials_id);
create index if not exists crm_fin_txn_by_date on crm_financial_transactions (occurred_on);

-- ── §8 consumables ──────────────────────────────────────────────────────────
create table if not exists crm_consumable_components (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  unit_cost   numeric(14,2) not null default 0,
  active      boolean not null default true,
  created_by  uuid references crm_users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_crm_consumable_components_updated on crm_consumable_components;
create trigger trg_crm_consumable_components_updated before update on crm_consumable_components
  for each row execute function crm_fin_set_updated_at();

create table if not exists crm_lead_consumables (
  id                  uuid primary key default gen_random_uuid(),
  lead_financials_id  uuid not null references crm_lead_financials(id) on delete cascade,
  component_id        uuid references crm_consumable_components(id) on delete set null,
  description         text not null,
  quantity            numeric(12,3) not null default 1,
  unit_cost           numeric(14,2) not null default 0,
  total_cost          numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  created_by          uuid references crm_users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists crm_lead_consumables_by_record on crm_lead_consumables (lead_financials_id);

-- ── §6/§7 doctor compensation rules + per-lead frozen lines ─────────────────
create table if not exists crm_doctor_compensation_rules (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null,                              -- soft ref (booking)
  doctor_name     text,
  service_id      uuid,                                       -- soft ref; null = applies to bundle/any
  service_name    text,
  kind            crm_compensation_kind not null,
  value           numeric(14,2) not null default 0,           -- pct (0..100) or fixed amount
  basis           crm_compensation_basis not null default 'quoted_price',
  active          boolean not null default true,
  effective_from  date,
  effective_to    date,
  created_by      uuid references crm_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists crm_doc_comp_rules_lookup on crm_doctor_compensation_rules (doctor_id, service_id) where active;
drop trigger if exists trg_crm_doc_comp_rules_updated on crm_doctor_compensation_rules;
create trigger trg_crm_doc_comp_rules_updated before update on crm_doctor_compensation_rules
  for each row execute function crm_fin_set_updated_at();

create table if not exists crm_lead_doctor_compensation (
  id                  uuid primary key default gen_random_uuid(),
  lead_financials_id  uuid not null references crm_lead_financials(id) on delete cascade,
  doctor_id           uuid not null,                          -- soft ref
  doctor_name         text,
  kind                crm_compensation_kind not null,
  value               numeric(14,2) not null default 0,
  basis               crm_compensation_basis not null default 'quoted_price',
  -- Frozen computed amount at record time; recomputed via lib/financial on edit.
  computed_amount     numeric(14,2) not null default 0,
  created_by          uuid references crm_users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists crm_lead_doc_comp_by_record on crm_lead_doctor_compensation (lead_financials_id);

-- ── §1H doctor-funded payments (SEPARATE from compensation) ─────────────────
create table if not exists crm_doctor_funded_payments (
  id                  uuid primary key default gen_random_uuid(),
  lead_financials_id  uuid not null references crm_lead_financials(id) on delete cascade,
  lead_id             uuid not null references leads(id) on delete cascade,
  doctor_id           uuid not null,                          -- soft ref
  doctor_name         text,
  amount              numeric(14,2) not null,
  occurred_on         date not null default current_date,
  note                text,
  created_by          uuid references crm_users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists crm_doc_funded_by_record on crm_doctor_funded_payments (lead_financials_id);

-- ── §9 external costs ───────────────────────────────────────────────────────
create table if not exists crm_external_costs (
  id                  uuid primary key default gen_random_uuid(),
  lead_financials_id  uuid not null references crm_lead_financials(id) on delete cascade,
  category            crm_external_cost_category not null default 'other',
  description         text not null,
  amount              numeric(14,2) not null default 0,
  vendor              text,
  occurred_on         date not null default current_date,
  created_by          uuid references crm_users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists crm_external_costs_by_record on crm_external_costs (lead_financials_id);

-- ── §4 exceptional-discount approvals (reuses existing escalations) ─────────
create table if not exists crm_discount_approvals (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references leads(id) on delete cascade,
  lead_financials_id    uuid references crm_lead_financials(id) on delete cascade,
  escalation_id         uuid references escalations(id) on delete set null,
  requested_by          uuid references crm_users(id) on delete set null,
  base_service_price    numeric(14,2) not null,
  requested_quoted_price numeric(14,2) not null,
  max_allowed_pct       numeric(5,2) not null,
  requested_pct         numeric(5,2) not null,
  status                crm_discount_approval_status not null default 'pending',
  decided_by            uuid references crm_users(id) on delete set null,
  decided_at            timestamptz,
  -- approve-with-modified-price: the price the approver actually granted.
  approved_quoted_price numeric(14,2),
  reason                text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists crm_discount_approvals_by_lead on crm_discount_approvals (lead_id);
create index if not exists crm_discount_approvals_status on crm_discount_approvals (status);
drop trigger if exists trg_crm_discount_approvals_updated on crm_discount_approvals;
create trigger trg_crm_discount_approvals_updated before update on crm_discount_approvals
  for each row execute function crm_fin_set_updated_at();

-- ── §5/§16 append-only financial audit log ──────────────────────────────────
create table if not exists crm_financial_audit_log (
  id              uuid primary key default gen_random_uuid(),
  entity_type     text not null,                              -- e.g. 'discount_rule','lead_financials'
  entity_id       uuid,
  action          text not null,                              -- 'create','update','delete','approve','force_price',…
  field           text,                                       -- changed field (for updates)
  old_value       jsonb,
  new_value       jsonb,
  actor_user_id   uuid references crm_users(id) on delete set null,
  actor_role      text,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists crm_fin_audit_by_entity on crm_financial_audit_log (entity_type, entity_id);
create index if not exists crm_fin_audit_by_time on crm_financial_audit_log (created_at desc);

-- ── enable RLS on every new table (server/service-role bypasses) ────────────
do $$
declare t text;
begin
  foreach t in array array[
    'crm_financial_service_settings','crm_discount_rules','crm_lead_financials',
    'crm_financial_transactions','crm_consumable_components','crm_lead_consumables',
    'crm_doctor_compensation_rules','crm_lead_doctor_compensation','crm_doctor_funded_payments',
    'crm_external_costs','crm_discount_approvals','crm_financial_audit_log'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
