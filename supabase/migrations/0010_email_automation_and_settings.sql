-- Email automation + settings-backbone hardening.
--
-- Additive-only. Introduces the email-rule engine and an append-only email
-- send log with a hard idempotency key. Every other Settings section
-- (tags, lost reasons, SLA/stage-reply rules, follow-up workflow stages,
-- target CPL, AI prompt) already has a table from the CRM baseline; this
-- migration only guarantees the two that did not exist yet.

set search_path = public, extensions;

-- ── Email rules ────────────────────────────────────────────────
-- A flexible rule framework rather than three hard-coded cases. `trigger`
-- names the event class; `recipients` is a jsonb array of entries such as
--   {"type":"static","value":"ops@clinic.com"}
--   {"type":"role","value":"auditor"}
--   {"type":"involved_lead"}          -- resolves the triggering lead's email
--   {"type":"moderators"} / {"type":"auditors"}
-- `conditions` carries trigger-specific tuning (e.g. {"days_before":5}).
-- `schedule` carries {"cron":"0 9 * * *","timezone":"Africa/Cairo"} for
-- time-based rules. `dedupe_window_hours` bounds idempotency for recurring
-- triggers so the same lead/rule/day cannot be emailed twice.
create table if not exists public.crm_email_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text unique,
  name text not null,
  description text,
  trigger text not null,
  is_active boolean not null default true,
  conditions jsonb not null default '{}'::jsonb,
  recipients jsonb not null default '[]'::jsonb,
  subject_template text,
  body_template text,
  schedule jsonb not null default '{}'::jsonb,
  dedupe_window_hours integer,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_email_rules_trigger_idx
  on public.crm_email_rules(trigger) where is_active;

-- ── Email send log (append-only) ───────────────────────────────
-- Records every email the application generated. `status` reflects only what
-- the provider actually told us: queued → sent | failed | skipped. We never
-- fabricate delivery status beyond the provider response. `dedupe_key` gives
-- idempotency: an insert that collides on it is a no-op re-send guard.
create table if not exists public.crm_email_log (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid references public.crm_email_rules(id) on delete set null,
  rule_key text,
  trigger text,
  lead_id uuid references public.leads(id) on delete set null,
  recipients text[] not null default '{}',
  subject text,
  body text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'failed', 'skipped')),
  provider text,
  provider_message_id text,
  error text,
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists crm_email_log_dedupe_uidx
  on public.crm_email_log(dedupe_key) where dedupe_key is not null;
create index if not exists crm_email_log_created_idx
  on public.crm_email_log(created_at desc);
create index if not exists crm_email_log_lead_idx
  on public.crm_email_log(lead_id);

-- Seed the three required built-in rules. Disabled by default so nothing sends
-- until an authorized user reviews recipients/templates and enables them.
insert into public.crm_email_rules (rule_key, name, description, trigger, is_active, conditions, recipients, subject_template, body_template, schedule, dedupe_window_hours)
values
  (
    'booking_created',
    'Patient booking created',
    'Notify the patient, moderator and auditor when a new booking is created.',
    'booking_created',
    false,
    '{}'::jsonb,
    '[{"type":"involved_lead"},{"type":"moderators"},{"type":"auditors"}]'::jsonb,
    'Booking confirmed — {{patient_name}}',
    'A booking was created for {{patient_name}} on {{appointment_datetime}} ({{service_name}}).',
    '{}'::jsonb,
    24
  ),
  (
    'booking_under_review',
    'Booking under review & <5 days away',
    'Notify moderator and auditor when a booking is still under review and less than five days away.',
    'booking_under_review',
    false,
    '{"days_before":5}'::jsonb,
    '[{"type":"moderators"},{"type":"auditors"}]'::jsonb,
    'Booking needs review — {{patient_name}} ({{appointment_date}})',
    '{{patient_name}} has a booking on {{appointment_datetime}} that is still under review and less than {{days_before}} days away.',
    '{}'::jsonb,
    24
  ),
  (
    'overdue_leads_daily',
    'Daily overdue leads summary',
    'Send the auditor a summary of overdue leads at the start of each day.',
    'overdue_leads_daily',
    false,
    '{}'::jsonb,
    '[{"type":"auditors"}]'::jsonb,
    'Overdue leads — {{report_date}}',
    'There are {{overdue_count}} overdue leads as of {{report_date}}.',
    '{"cron":"0 9 * * *","timezone":"Africa/Cairo"}'::jsonb,
    20
  )
on conflict (rule_key) do nothing;

-- RLS: readable by any active CRM user; all writes go through service_role.
alter table public.crm_email_rules enable row level security;
alter table public.crm_email_log enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_email_rules', 'crm_email_log'] loop
    execute format('drop policy if exists "CRM active users can read" on public.%I', t);
    execute format(
      'create policy "CRM active users can read" on public.%I for select to authenticated using (crm_has_active_user())',
      t
    );
  end loop;
end $$;

grant select on public.crm_email_rules, public.crm_email_log to authenticated;
grant all privileges on public.crm_email_rules, public.crm_email_log to service_role;
