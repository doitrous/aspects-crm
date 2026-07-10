-- ============================================================================
-- 0004_financial_spec_gaps.sql
--
-- Closes three gaps between 0002 (already applied) and the confirmed spec.
-- Additive and idempotent. NO destructive changes: nothing is dropped, renamed,
-- or retyped, and no existing column changes meaning.
--
-- HOW TO APPLY: CRM Supabase project (wgczgrhcqishvhbitvml) → SQL Editor →
-- paste this whole file → Run. Safe to run more than once.
--
-- Gaps closed:
--  1. §"EXTERNAL COSTS" requires notes + reference/receipt, and an
--     `external_provider` category.
--  2. §"CONSUMABLES" requires a patient-specific override with an override
--     reason (the change itself is captured in crm_financial_audit_log).
--  3. §"PAYMENTS" lists `cancellation adjustments` separately from `credits`.
--
-- Note on `vendor`: 0002 already stores the external-cost payee as `vendor`.
-- Renaming it to `payee` would be a destructive change to a live column, so it
-- keeps its name and is treated as the payee throughout the app.
-- ============================================================================

-- ── 1. new enum values (ADD VALUE IF NOT EXISTS is idempotent) ──────────────
-- These are not USED anywhere later in this file, so running them inside the
-- editor's transaction is safe on PG12+.
alter type crm_external_cost_category add value if not exists 'external_provider';
alter type crm_transaction_kind       add value if not exists 'cancellation_adjustment';

-- ── 2. external costs: notes + reference/receipt ────────────────────────────
alter table crm_external_costs add column if not exists notes     text;
alter table crm_external_costs add column if not exists reference text;

comment on column crm_external_costs.vendor    is 'Payee for this external cost line.';
comment on column crm_external_costs.reference is 'Receipt / invoice reference.';

-- ── 3. consumables: patient-specific override + reason ──────────────────────
alter table crm_lead_consumables add column if not exists is_override      boolean not null default false;
alter table crm_lead_consumables add column if not exists override_reason  text;

comment on column crm_lead_consumables.is_override is
  'True when this line overrides the service default consumable cost for this patient.';
comment on column crm_lead_consumables.override_reason is
  'Required when is_override; the change is additionally recorded in crm_financial_audit_log.';

-- Enforce "an override must carry a reason" without touching existing rows
-- (the table is empty today; NOT VALID would be used otherwise).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'crm_lead_consumables_override_reason_ck'
  ) then
    alter table crm_lead_consumables
      add constraint crm_lead_consumables_override_reason_ck
      check (not is_override or (override_reason is not null and length(btrim(override_reason)) > 0));
  end if;
end $$;
