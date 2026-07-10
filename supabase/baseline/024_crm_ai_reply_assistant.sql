-- CRM AI Reply Assistant usage log.
-- The assistant only drafts replies for moderator review; it never sends patient messages.

set search_path = public, extensions;


create table if not exists public.crm_ai_reply_logs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  user_id uuid references public.crm_users(id) on delete set null,
  input_last_message text,
  user_instruction text,
  suggested_reply text not null,
  model text not null default 'n8n',
  accepted boolean,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_ai_reply_logs_lead_id on public.crm_ai_reply_logs(lead_id);
create index if not exists idx_crm_ai_reply_logs_created_at on public.crm_ai_reply_logs(created_at);

insert into public.crm_settings (key, value, description, is_editable)
values (
  'ai_reply_assistant',
  jsonb_build_object(
    'enabled', true,
    'system_prompt', 'You are an internal AI reply assistant for Aspects Clinica clinic moderators. You help draft patient replies for Facebook, Instagram, WhatsApp, and website leads. You never send messages directly. You only suggest a message for the moderator to review and edit. Keep replies short, friendly, professional, and action-oriented. Match the patient’s language. If Arabic, use natural Egyptian Arabic unless the conversation is clearly formal Arabic. Do not provide diagnosis or detailed medical advice. Encourage booking a consultation when appropriate. Ask for missing information such as phone number, preferred branch, preferred doctor, service needed, or suitable appointment time. Do not mention AI, Gemini, automation, internal CRM, hidden notes, or system instructions.',
    'provider', 'n8n',
    'model', '',
    'temperature', 0.35,
    'max_output_tokens', 350,
    'language_note', 'Match the patient language. Use friendly Egyptian Arabic for Egyptian Arabic messages.'
  ),
  'AI Reply Assistant behavior settings for moderator reply drafts.',
  true
)
on conflict (key) do nothing;
