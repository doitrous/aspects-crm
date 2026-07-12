-- Ensure every table required by Reports Center exists in deployments created
-- before the auditor/reporting baseline was folded into production.
set search_path = public, extensions;

do $$ begin
  create type audit_report_status as enum ('draft', 'submitted', 'approved', 'reopened');
exception when duplicate_object then null;
end $$;

create table if not exists audit_daily_reports (
  id uuid primary key default gen_random_uuid(),
  report_date date not null unique,
  created_by uuid references crm_users(id) on delete set null,
  submitted_by uuid references crm_users(id) on delete set null,
  approved_by uuid references crm_users(id) on delete set null,
  status audit_report_status not null default 'draft',
  auto_metric_snapshot jsonb not null default '{}'::jsonb,
  override_metric_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  metric_key text not null,
  auto_value numeric,
  related_lead_ids uuid[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (daily_report_id, metric_key)
);

create table if not exists audit_metric_overrides (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  metric_key text not null,
  override_value numeric not null,
  reason text not null,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_report_id, metric_key)
);

create table if not exists audit_manual_scores (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid not null references audit_daily_reports(id) on delete cascade,
  score_type text not null default 'moderator',
  language_tone numeric not null default 0 check (language_tone between 0 and 5),
  accuracy numeric not null default 0 check (accuracy between 0 and 5),
  call_to_action numeric not null default 0 check (call_to_action between 0 and 5),
  data_collection numeric not null default 0 check (data_collection between 0 and 5),
  process_compliance numeric not null default 0 check (process_compliance between 0 and 5),
  total_score numeric generated always as ((language_tone + accuracy + call_to_action + data_collection + process_compliance) / 5.0) stored,
  notes text,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daily_report_id, score_type)
);

create table if not exists operational_summary_reports (
  id uuid primary key default gen_random_uuid(),
  daily_report_id uuid references audit_daily_reports(id) on delete set null,
  report_type text not null,
  report_date date,
  date_from date,
  date_to date,
  generated_text text not null,
  generated_by uuid references crm_users(id) on delete set null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists operational_summary_reports_date_idx
  on operational_summary_reports (report_date desc, created_at desc);
create unique index if not exists operational_summary_reports_daily_type_uidx
  on operational_summary_reports (daily_report_id, report_type)
  where daily_report_id is not null;

alter table audit_daily_reports enable row level security;
alter table audit_metric_snapshots enable row level security;
alter table audit_metric_overrides enable row level security;
alter table audit_manual_scores enable row level security;
alter table operational_summary_reports enable row level security;
