-- CRM unread / unanswered reply lifecycle, stage SLA rules, and auditor settings.

set search_path = public, extensions;


alter table public.leads
  add column if not exists has_unread boolean not null default false,
  add column if not exists unread_since timestamptz,
  add column if not exists last_incoming_at timestamptz,
  add column if not exists last_outgoing_at timestamptz,
  add column if not exists last_handled_at timestamptz,
  add column if not exists unread_message_count integer not null default 0,
  add column if not exists last_unread_message_id uuid,
  add column if not exists reply_overdue_at timestamptz,
  add column if not exists is_reply_overdue boolean not null default false;

create index if not exists idx_leads_has_unread on public.leads(has_unread);
create index if not exists idx_leads_is_reply_overdue on public.leads(is_reply_overdue);
create index if not exists idx_leads_unread_since on public.leads(unread_since);
create index if not exists idx_leads_last_incoming_at on public.leads(last_incoming_at);
create index if not exists idx_leads_status_unread on public.leads(status, has_unread, is_reply_overdue);

create table if not exists public.crm_stage_reply_rules (
  id uuid primary key default gen_random_uuid(),
  stage_key text not null unique,
  stage_label text not null,
  reply_deadline_minutes integer not null default 30,
  warning_threshold_minutes integer not null default 20,
  is_active boolean not null default true,
  respect_working_hours boolean not null default false,
  working_hours_start time,
  working_hours_end time,
  timezone text not null default 'Africa/Cairo',
  overdue_severity text not null default 'medium',
  highlight_color text,
  escalation_enabled boolean not null default false,
  escalation_after_minutes integer,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.crm_stage_reply_rules (
  stage_key,
  stage_label,
  reply_deadline_minutes,
  warning_threshold_minutes,
  overdue_severity,
  highlight_color
)
values
  ('new_lead', 'New Lead', 15, 10, 'high', '#DC2626'),
  ('qualified', 'Qualified', 30, 20, 'medium', '#F59E0B'),
  ('follow_up', 'Follow-Up', 60, 45, 'medium', '#F59E0B'),
  ('post_op_follow_up', 'Post-Op F/U', 30, 20, 'high', '#DC2626'),
  ('booked', 'Booked', 60, 45, 'medium', '#F59E0B'),
  ('lost', 'Lost', 120, 90, 'medium', '#F59E0B')
on conflict (stage_key) do nothing;

create table if not exists public.crm_unread_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  event_type text not null,
  message_id uuid,
  actor_id uuid references public.crm_users(id) on delete set null,
  reason text,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_unread_events_lead_id on public.crm_unread_events(lead_id);
create index if not exists idx_crm_unread_events_created_at on public.crm_unread_events(created_at);

create table if not exists public.auditor_settings (
  id uuid primary key default gen_random_uuid(),
  target_cpl_egp numeric not null default 0,
  ai_sampling_percent integer not null default 50,
  response_time_threshold_minutes integer not null default 30,
  followup_completion_target integer not null default 85,
  working_day_start time,
  working_day_end time,
  red_flag_categories jsonb not null default '["Bad tone", "No CTA", "Wrong information", "Unsafe medical advice", "Long delay", "Patient unanswered"]'::jsonb,
  red_flag_severity_options jsonb not null default '["low", "medium", "high", "critical"]'::jsonb,
  effective_from date not null default current_date,
  effective_to date,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_auditor_settings_effective on public.auditor_settings(effective_from, effective_to);

create table if not exists public.ai_audit_suggestion_reviews (
  id uuid primary key default gen_random_uuid(),
  ai_audit_result_id uuid,
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.crm_conversations(id) on delete set null,
  suggestion_type text,
  suggestion_text text,
  decision text not null,
  auditor_comment text,
  reviewed_by uuid references public.crm_users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_audit_suggestion_reviews_lead_id on public.ai_audit_suggestion_reviews(lead_id);
create index if not exists idx_ai_audit_suggestion_reviews_decision on public.ai_audit_suggestion_reviews(decision);

do $$
begin
  if to_regclass('public.audit_red_flags') is not null then
    alter table public.audit_red_flags
      add column if not exists severity text not null default 'medium',
      add column if not exists recommended_action text,
      add column if not exists manager_review_required boolean not null default false,
      add column if not exists status text not null default 'open',
      add column if not exists resolved_by uuid references public.crm_users(id) on delete set null,
      add column if not exists resolved_at timestamptz;

    create index if not exists idx_audit_red_flags_severity on public.audit_red_flags(severity);
    create index if not exists idx_audit_red_flags_status on public.audit_red_flags(status);
  end if;

  if to_regclass('public.audit_red_flag_conversations') is not null then
    alter table public.audit_red_flag_conversations
      add column if not exists severity text not null default 'medium',
      add column if not exists recommended_action text,
      add column if not exists manager_review_required boolean not null default false,
      add column if not exists status text not null default 'open',
      add column if not exists resolved_by uuid references public.crm_users(id) on delete set null,
      add column if not exists resolved_at timestamptz;

    create index if not exists idx_audit_red_flag_conversations_severity on public.audit_red_flag_conversations(severity);
    create index if not exists idx_audit_red_flag_conversations_status on public.audit_red_flag_conversations(status);
  end if;
end $$;
