
set search_path = public, extensions;

alter table lead_messages add column if not exists patient_id uuid references patients(id) on delete set null;
alter table lead_messages add column if not exists conversation_id text;
alter table lead_messages add column if not exists platform_user_id text;
alter table lead_messages add column if not exists message_type text not null default 'text';
alter table lead_messages add column if not exists attachment_url text;
alter table lead_messages add column if not exists moderator_notes text;
alter table lead_messages add column if not exists created_by uuid references crm_users(id) on delete set null;

create index if not exists lead_messages_patient_id_idx on lead_messages(patient_id);
create index if not exists lead_messages_conversation_id_idx on lead_messages(conversation_id);
create index if not exists lead_messages_platform_user_id_idx on lead_messages(platform_user_id);
create index if not exists lead_messages_message_at_idx on lead_messages(message_at);

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
