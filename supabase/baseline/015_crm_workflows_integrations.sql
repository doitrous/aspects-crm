-- Aspects Clinica CRM workflows and integrations.
-- Apply to the separate CRM Supabase project after 001_crm_schema.sql.

set search_path = public, extensions;


create table if not exists google_sheets_export_runs (
  id uuid primary key default gen_random_uuid(),
  export_scope text not null default 'all',
  spreadsheet_id text,
  tab_name text not null default 'Leads Collection',
  row_count integer not null default 0,
  status text not null default 'pending',
  error text,
  requested_by uuid references crm_users(id) on delete set null,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  mode text not null default 'leads',
  source_filename text,
  created_count integer not null default 0,
  duplicate_flagged_count integer not null default 0,
  skipped_count integer not null default 0,
  error_rows jsonb not null default '[]'::jsonb,
  created_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table old_database_followups
  add column if not exists import_batch_id uuid references crm_import_batches(id) on delete set null,
  add column if not exists converted_lead_id uuid references leads(id) on delete set null;

alter table leads
  add column if not exists ai_summary text,
  add column if not exists ai_extracted_fields jsonb not null default '{}'::jsonb,
  add column if not exists ai_suggestions jsonb not null default '{}'::jsonb,
  add column if not exists ai_confidence jsonb not null default '{}'::jsonb,
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists ai_raw_output jsonb not null default '{}'::jsonb,
  add column if not exists ai_last_run_at timestamptz;

create table if not exists ai_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  provider text not null,
  model text,
  status text not null default 'pending',
  extracted_fields jsonb not null default '{}'::jsonb,
  suggestions jsonb not null default '{}'::jsonb,
  confidence jsonb not null default '{}'::jsonb,
  summary text,
  raw_output jsonb not null default '{}'::jsonb,
  error text,
  requested_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists ai_suggestion_actions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  extraction_run_id uuid references ai_extraction_runs(id) on delete set null,
  field_key text not null,
  suggested_value text,
  action text not null check (action in ('accepted', 'rejected')),
  actor_user_id uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists follow_up_stage_templates (
  id uuid primary key default gen_random_uuid(),
  workflow_type text not null check (workflow_type in ('follow_up', 'post_op')),
  stage_number integer not null check (stage_number between 1 and 5),
  title text not null,
  default_due_days integer not null default 1,
  checklist jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workflow_type, stage_number)
);

create table if not exists lead_follow_up_stages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  workflow_type text not null check (workflow_type in ('follow_up', 'post_op')),
  stage_number integer not null check (stage_number between 1 and 5),
  due_at timestamptz,
  assigned_to uuid references crm_users(id) on delete set null,
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  outcome text,
  patient_response text,
  complications_flag boolean not null default false,
  escalation_flag boolean not null default false,
  status crm_follow_up_stage_status not null default 'not_started',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, workflow_type, stage_number)
);

create index if not exists lead_follow_up_stages_due_at_idx on lead_follow_up_stages(due_at);
create index if not exists lead_follow_up_stages_workflow_status_idx on lead_follow_up_stages(workflow_type, status);

insert into crm_settings (key, value, description, is_editable)
values
  ('google_sheets', '{"spreadsheet_id":"","tab_name":"Leads Collection","columns":["ID","Chat Link","Qualification","الحالة","الاسم","المنسق","تاريخ اول تواصل","Gender","رقم التليفون","المصدر","الخدمة","الطبيب","السعر المبدأي","الخطوة القادمة","الملاحظات","الملاحظات الطبية","التاريخ المرضي","branch","campaign","ad name","urgency","tags","escalation status"]}'::jsonb, 'Google Sheets mirror/export settings. CRM remains source of truth.', true),
  ('ai_extraction', '{"enabled_on_ingest":false,"provider":"none","prompt_template":"Extract CRM fields as strict JSON without replying to the patient."}'::jsonb, 'AI extraction settings and prompt template.', true)
on conflict (key) do update set value = excluded.value, description = excluded.description, is_editable = excluded.is_editable, updated_at = now();

insert into follow_up_stage_templates (workflow_type, stage_number, title, default_due_days, checklist)
values
  ('follow_up', 1, 'F/U 1', 1, '["Call patient","Update interest level","Set next step"]'::jsonb),
  ('follow_up', 2, 'F/U 2', 3, '["Second contact attempt","Answer objections","Set next step"]'::jsonb),
  ('follow_up', 3, 'F/U 3', 7, '["Third contact attempt","Offer available slots","Update status"]'::jsonb),
  ('follow_up', 4, 'F/U 4', 14, '["Final warm follow-up","Ask for decision","Update status"]'::jsonb),
  ('follow_up', 5, 'F/U 5', 30, '["Last follow-up","Move to Lost if no interest","Record reason"]'::jsonb),
  ('post_op', 1, 'Post-Op F/U 1', 1, '["Check pain level","Review warning signs","Document response"]'::jsonb),
  ('post_op', 2, 'Post-Op F/U 2', 3, '["Check recovery","Confirm medication use","Escalate complications"]'::jsonb),
  ('post_op', 3, 'Post-Op F/U 3', 7, '["Clinical check-in","Review photos if provided","Set next review"]'::jsonb),
  ('post_op', 4, 'Post-Op F/U 4', 14, '["Outcome check","Complication screen","Doctor review if needed"]'::jsonb),
  ('post_op', 5, 'Post-Op F/U 5', 30, '["Final outcome","Review satisfaction","Close follow-up"]'::jsonb)
on conflict (workflow_type, stage_number) do update set
  title = excluded.title,
  default_due_days = excluded.default_due_days,
  checklist = excluded.checklist,
  updated_at = now();

alter table google_sheets_export_runs enable row level security;
alter table crm_import_batches enable row level security;
alter table ai_extraction_runs enable row level security;
alter table ai_suggestion_actions enable row level security;
alter table follow_up_stage_templates enable row level security;
alter table lead_follow_up_stages enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'google_sheets_export_runs', 'crm_import_batches', 'ai_extraction_runs',
    'ai_suggestion_actions', 'follow_up_stage_templates', 'lead_follow_up_stages'
  ]
  loop
    execute format('drop policy if exists "CRM active users can read" on %I', table_name);
    execute format(
      'create policy "CRM active users can read" on %I for select to authenticated using (crm_has_active_user())',
      table_name
    );
  end loop;
end $$;
