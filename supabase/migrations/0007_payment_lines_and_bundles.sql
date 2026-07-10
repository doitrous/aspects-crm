-- ============================================================================
-- 0007_payment_lines_and_bundles.sql
--
-- Closes the last two gaps between the applied schema (0002 + 0004) and the
-- confirmed financial spec. Additive and idempotent. NO destructive changes:
-- nothing is dropped, renamed, or retyped, and no existing column changes
-- meaning. Existing transaction rows become `status = 'completed'`, which is
-- what they already meant before a status column existed.
--
-- HOW TO APPLY: CRM Supabase project (wgczgrhcqishvhbitvml) → SQL Editor →
-- paste this whole file → Run. Safe to run more than once.
--
-- Gaps closed:
--  1. §"PAYMENTS": each payment line must carry a **status** and a **receipt
--     number** alongside amount / method / date / reference / entered-by.
--     Only `completed` lines count toward collected money; a `pending` line is
--     recorded but must not reduce the patient's outstanding balance.
--  2. §"BUNDLES": a bundle (e.g. Hydrafacial + Dental Scaling for 1,500 EGP)
--     is one agreed price covering several services. `crm_lead_financials`
--     already holds the single combined price; the constituent services had
--     nowhere to live. `crm_lead_bundle_items` records the composition without
--     splitting the price, so profitability stays anchored to the one quoted
--     figure while reports can still attribute a bundle to its services.
--  3. §"PAYMENT BY DOCTOR": the spec requires a reference and an explicit
--     "does this reduce the patient's outstanding balance?" flag. A doctor may
--     settle part of a bill (reduces the balance) or fund something alongside
--     it (does not) — the two must not be conflated, and neither is the same as
--     the compensation the clinic owes that doctor.
--
-- Note: doctors on a bundle are already modelled — `crm_lead_doctor_compensation`
-- is one row per doctor per lead, so "Doctor A fixed 500, Doctor B 25%" needs no
-- new table.
-- ============================================================================

-- ── 1. payment line status ──────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_payment_status') then
    create type crm_payment_status as enum ('pending','completed','failed','cancelled');
  end if;
end $$;

alter table crm_financial_transactions
  add column if not exists status crm_payment_status not null default 'completed';

alter table crm_financial_transactions
  add column if not exists receipt_number text;

comment on column crm_financial_transactions.status is
  'Only `completed` lines count toward collected money and the outstanding balance.';
comment on column crm_financial_transactions.receipt_number is
  'Receipt number issued to the patient for this line (distinct from `reference`, the gateway/bank ref).';

create index if not exists crm_fin_txn_by_status on crm_financial_transactions (status);

-- ── 2. bundle composition (§ bundles + multiple doctors) ────────────────────
create table if not exists crm_lead_bundle_items (
  id                  uuid primary key default gen_random_uuid(),
  lead_financials_id  uuid not null references crm_lead_financials(id) on delete cascade,
  service_settings_id uuid references crm_financial_service_settings(id) on delete set null,
  service_name        text not null,
  -- The service's own frozen list price at the time the bundle was assembled.
  -- Informational: the bill is the ONE `crm_lead_financials.quoted_price`, never
  -- the sum of these. Kept so a report can show what the bundle discounted from.
  base_price          numeric(14,2) not null default 0,
  created_by          uuid references crm_users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists crm_lead_bundle_items_by_record
  on crm_lead_bundle_items (lead_financials_id);

alter table crm_lead_bundle_items enable row level security;

comment on table crm_lead_bundle_items is
  'Services covered by one bundled price. The bill lives on crm_lead_financials.quoted_price; these rows never sum to it.';

-- ── 3. payment by doctor (§ payment by doctor) ──────────────────────────────
alter table crm_doctor_funded_payments
  add column if not exists reference text;

alter table crm_doctor_funded_payments
  add column if not exists reduces_patient_balance boolean not null default true;

comment on column crm_doctor_funded_payments.reduces_patient_balance is
  'True when the doctor is settling part of the patient bill (lowers outstanding). False when the doctor funds something alongside the bill. Never conflate this with compensation OWED to the doctor (crm_lead_doctor_compensation).';

