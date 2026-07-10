-- Controlled escalation reasons for the CRM Settings -> Escalation Reasons tab.
-- The lead/escalation workflow still requires moderator details; this table
-- supplies the controlled reason list without rewriting historical escalations.

create table if not exists public.crm_escalation_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists crm_escalation_reasons_label_key
  on public.crm_escalation_reasons (lower(label));

create index if not exists crm_escalation_reasons_active_order_idx
  on public.crm_escalation_reasons (is_active, display_order, label);

alter table public.crm_escalation_reasons enable row level security;

insert into public.crm_escalation_reasons (label, severity, display_order)
values
  ('Pricing approval needed', 'medium', 10),
  ('Medical review needed', 'high', 20),
  ('Booking conflict', 'medium', 30),
  ('Patient complaint', 'high', 40)
on conflict do nothing;
