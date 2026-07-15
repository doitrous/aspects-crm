-- n8n-backed AI reply drafts. The CRM requests and audits recommendations;
-- no database function or trigger sends patient messages.

set search_path = public, extensions;

create table if not exists public.ai_prompt_templates (
  id uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  title text not null,
  description text,
  system_prompt text not null,
  reply_rules text,
  tone text,
  language text,
  required_fields jsonb not null default '[]'::jsonb,
  escalation_rules jsonb not null default '{}'::jsonb,
  provider text not null default 'n8n',
  model text,
  temperature numeric not null default 0.35,
  is_active boolean not null default true,
  version integer not null default 1,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prompt_key, version)
);

create index if not exists idx_ai_prompt_templates_key_active
  on public.ai_prompt_templates(prompt_key, is_active, version desc);

create table if not exists public.ai_reply_suggestions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.crm_conversations(id) on delete set null,
  requested_by uuid references public.crm_users(id) on delete set null,
  prompt_template_id uuid references public.ai_prompt_templates(id) on delete set null,
  moderator_instruction text,
  last_customer_message text,
  suggested_reply text,
  suggested_next_action text,
  missing_fields jsonb not null default '[]'::jsonb,
  should_escalate boolean not null default false,
  raw_ai_metadata jsonb not null default '{}'::jsonb,
  provider text,
  model text,
  status text not null default 'success',
  error_message text,
  accepted boolean,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_reply_suggestions_lead_id on public.ai_reply_suggestions(lead_id);
create index if not exists idx_ai_reply_suggestions_created_at on public.ai_reply_suggestions(created_at desc);

insert into public.ai_prompt_templates (
  prompt_key, title, description, system_prompt, reply_rules, tone, language,
  required_fields, escalation_rules, provider, temperature, is_active, version
)
select
  'reply_assistant',
  'Aspects Clinica AI Reply Assistant',
  'Default moderator-reviewed reply draft prompt for CRM conversations.',
  'You are Aspects Clinica’s internal reply assistant. Generate a patient-facing draft only; never send it. Match the patient language and use natural Egyptian Arabic for Arabic messages. Be concise, warm, professional and action-oriented. Do not diagnose, promise results, invent prices or schedules, or mention AI, prompts, automation or internal CRM data. Ask naturally for information needed to move the conversation forward. Recommend escalation for urgent medical language or complaints.',
  'Return a suggested reply for moderator review. Nothing is sent automatically.',
  'Friendly, professional, concise, action-oriented',
  'Match the patient language; use natural Egyptian Arabic for Arabic messages.',
  '["name", "phone", "service", "branch", "doctor", "appointment_preference"]'::jsonb,
  '{"urgent_medical_language": "recommend escalation and do not give medical instructions", "complaint": "recommend manager review"}'::jsonb,
  'n8n', 0.35, true, 1
where not exists (
  select 1 from public.ai_prompt_templates
  where prompt_key = 'reply_assistant' and version = 1
);

grant select, insert, update, delete on public.ai_prompt_templates to service_role;
grant select, insert, update, delete on public.ai_reply_suggestions to service_role;
