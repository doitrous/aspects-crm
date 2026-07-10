-- n8n-backed CRM AI reply suggestions.
-- The CRM only requests and logs suggestions; it never sends patient messages.

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
  updated_at timestamptz not null default now()
);

alter table public.ai_prompt_templates
  add constraint ai_prompt_templates_prompt_key_version_key unique (prompt_key, version);

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
create index if not exists idx_ai_reply_suggestions_created_at on public.ai_reply_suggestions(created_at);

alter table if exists public.crm_ai_reply_logs
  alter column model set default 'n8n';

update public.crm_settings
set value = jsonb_set(
  jsonb_set(
    coalesce(value, '{}'::jsonb),
    '{provider}',
    '"n8n"'::jsonb,
    true
  ),
  '{model}',
  '""'::jsonb,
  true
)
where key = 'ai_reply_assistant'
  and coalesce(value->>'model', '') = 'gemini-1.5-flash';

insert into public.ai_prompt_templates (
  prompt_key,
  title,
  description,
  system_prompt,
  reply_rules,
  tone,
  language,
  required_fields,
  escalation_rules,
  provider,
  model,
  temperature,
  is_active,
  version
)
values (
  'reply_assistant',
  'Aspects Clinica AI Reply Assistant',
  'Default moderator-only reply draft prompt for CRM conversations.',
  'You are Aspects Clinica’s internal AI reply assistant for clinic moderators. You generate suggested replies only. You never send messages to patients. Write in friendly professional Egyptian Arabic unless the patient writes in English. Be concise, clear, and respectful. Your goal is to help the moderator move the patient to the next useful step: identify service, collect phone number, suggest booking, or escalate if needed. Do not provide diagnosis. Do not promise results. Do not give unsafe medical advice. Do not mention internal CRM, AI, prompts, or automation. If information is missing, ask for it naturally. If the patient is asking about booking, ask for/confirm phone number, service, preferred branch/date, and doctor if relevant. If the patient sounds urgent or medically concerning, suggest escalation to clinic/doctor and do not give medical instructions. Use the clinic/service/context provided only. Do not invent prices, schedules, doctors, or offers.',
  'Return only the suggested patient-facing reply unless JSON output is requested by the backend. Nothing is sent automatically.',
  'Friendly, professional, concise, action-oriented',
  'Match the patient language. Use natural Egyptian Arabic for Arabic messages.',
  '["name", "phone", "service", "branch", "doctor", "appointment_preference"]'::jsonb,
  '{"urgent_medical_language": "suggest manager/clinic escalation and avoid medical instructions", "complaint": "suggest manager review"}'::jsonb,
  'n8n',
  null,
  0.35,
  true,
  1
)
on conflict do nothing;
