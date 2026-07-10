-- Aspects Clinica CRM foundation schema.
-- Apply this migration to the separate CRM Supabase project, not the booking database.

set search_path = public, extensions;

create extension if not exists pgcrypto;

do $$ begin
  create type crm_role as enum ('owner_admin', 'manager', 'moderator', 'doctor', 'auditor', 'viewer');
exception when duplicate_object then null;
end $$;

alter type crm_role add value if not exists 'auditor';

do $$ begin
  create type crm_lead_status as enum ('new_lead', 'qualified', 'booked', 'follow_up', 'post_op_follow_up', 'lost');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type crm_duplicate_status as enum ('pending', 'linked', 'merged', 'dismissed');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type crm_escalation_status as enum ('none', 'escalated', 'in_review', 'resolved');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type crm_follow_up_stage_status as enum ('not_started', 'in_progress', 'completed', 'skipped');
exception when duplicate_object then null;
end $$;

create or replace function crm_update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function crm_normalize_text_identifier(input_value text)
returns text
language sql
immutable
as $$
  select nullif(lower(trim(input_value)), '');
$$;

create or replace function crm_normalize_phone(input_value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(input_value, ''), '[^0-9]+', '', 'g'), '');
$$;

create table if not exists crm_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  description text,
  is_editable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists crm_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  booking_admin_profile_id uuid,
  email text not null unique,
  full_name text not null default '',
  role crm_role not null default 'viewer',
  doctor_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lead_id_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique default 'Default lead ID',
  prefix text not null default 'L',
  padding integer not null default 4 check (padding between 1 and 12),
  next_number bigint not null default 1 check (next_number > 0),
  include_year boolean not null default false,
  year_format text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mrn_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null unique default 'Default MRN',
  prefix text not null default 'EC',
  padding integer not null default 4 check (padding between 1 and 12),
  next_number bigint not null default 1 check (next_number > 0),
  include_year boolean not null default false,
  year_format text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lead_id_rules_one_active
  on lead_id_rules (is_active)
  where is_active;

create unique index if not exists mrn_rules_one_active
  on mrn_rules (is_active)
  where is_active;

create table if not exists lead_sources (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  source_type text not null default 'social',
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  mrn text not null unique,
  name text,
  gender text,
  phone_country_code text,
  phone_number text,
  normalized_phone text,
  primary_lead_id uuid,
  booking_patient_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lost_reasons (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  patient_id uuid references patients(id) on delete set null,
  mrn text,
  status crm_lead_status not null default 'new_lead',
  chat_link text,
  normalized_chat_link text,
  platform_id text,
  normalized_platform_id text,
  platform text,
  qualification text,
  arabic_status text,
  name text,
  coordinator_user_id uuid references crm_users(id) on delete set null,
  first_contact_at timestamptz not null default now(),
  gender text,
  phone_country_code text,
  phone_number text,
  normalized_phone text,
  source_id uuid references lead_sources(id) on delete set null,
  service_name text,
  booking_service_id uuid,
  doctor_id uuid,
  initial_price numeric(12, 2),
  next_step text,
  notes text,
  medical_notes text,
  medical_history text,
  branch_id uuid,
  campaign text,
  ad_name text,
  urgency text,
  escalation_status crm_escalation_status not null default 'none',
  last_contact_at timestamptz,
  lost_reason_id uuid references lost_reasons(id) on delete restrict,
  lost_notes text,
  booking_appointment_id uuid,
  imported_from_old_database boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_lost_reason_required check (status <> 'lost' or lost_reason_id is not null)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_primary_lead_id_fkey'
  ) then
    alter table patients
      add constraint patients_primary_lead_id_fkey
      foreign key (primary_lead_id) references leads(id) on delete set null;
  end if;
end $$;

create index if not exists leads_status_idx on leads(status);
create index if not exists leads_source_id_idx on leads(source_id);
create index if not exists leads_doctor_id_idx on leads(doctor_id);
create index if not exists leads_branch_id_idx on leads(branch_id);
create index if not exists leads_first_contact_at_idx on leads(first_contact_at);
create index if not exists leads_normalized_phone_idx on leads(normalized_phone) where normalized_phone is not null;
create index if not exists leads_normalized_chat_link_idx on leads(normalized_chat_link) where normalized_chat_link is not null;
create index if not exists leads_normalized_platform_id_idx on leads(normalized_platform_id) where normalized_platform_id is not null;

create table if not exists lead_custom_fields (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label_ar text,
  label_en text not null,
  field_type text not null default 'text',
  is_enabled boolean not null default true,
  is_required boolean not null default false,
  display_order integer not null default 0,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lead_field_visibility_settings (
  id uuid primary key default gen_random_uuid(),
  field_key text not null,
  role crm_role not null,
  can_view boolean not null default true,
  can_edit boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (field_key, role)
);

create table if not exists lead_status_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_status crm_lead_status,
  to_status crm_lead_status not null,
  lost_reason_id uuid references lost_reasons(id) on delete set null,
  changed_by uuid references crm_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists lead_timeline_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text,
  actor_user_id uuid references crm_users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists lead_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  source_id uuid references lead_sources(id) on delete set null,
  direction text not null default 'inbound' check (direction in ('inbound', 'outbound', 'internal')),
  platform text not null,
  platform_message_id text,
  sender_name text,
  sender_platform_id text,
  message_text text,
  raw_payload jsonb not null default '{}'::jsonb,
  message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists lead_source_links (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  source_id uuid references lead_sources(id) on delete set null,
  platform text not null,
  chat_link text,
  normalized_chat_link text,
  platform_id text,
  normalized_platform_id text,
  is_primary boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_source_links_lead_id_idx on lead_source_links(lead_id);
create index if not exists lead_source_links_normalized_chat_link_idx
  on lead_source_links(normalized_chat_link)
  where normalized_chat_link is not null;
create index if not exists lead_source_links_normalized_platform_id_idx
  on lead_source_links(normalized_platform_id)
  where normalized_platform_id is not null;

create table if not exists lead_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lead_tag_assignments (
  lead_id uuid not null references leads(id) on delete cascade,
  tag_id uuid not null references lead_tags(id) on delete cascade,
  assigned_by uuid references crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

create table if not exists lead_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  duplicate_lead_id uuid not null references leads(id) on delete cascade,
  duplicate_type text not null check (duplicate_type in ('phone', 'chat_link', 'platform_id')),
  identifier_value text not null,
  status crm_duplicate_status not null default 'pending',
  notes text,
  reviewed_by uuid references crm_users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_duplicate_flags_not_self check (lead_id <> duplicate_lead_id),
  unique (lead_id, duplicate_lead_id, duplicate_type, identifier_value)
);

create table if not exists duplicate_review_actions (
  id uuid primary key default gen_random_uuid(),
  duplicate_flag_id uuid not null references lead_duplicate_flags(id) on delete cascade,
  action text not null check (action in ('linked', 'merged', 'dismissed', 'reopened')),
  action_by uuid references crm_users(id) on delete set null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists old_database_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  legacy_reference text,
  patient_name text,
  phone_number text,
  normalized_phone text,
  service_name text,
  doctor_name text,
  source_notes text,
  follow_up_due_at timestamptz,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  status crm_escalation_status not null default 'escalated',
  reason text,
  requested_by uuid references crm_users(id) on delete set null,
  assigned_to uuid references crm_users(id) on delete set null,
  resolved_by uuid references crm_users(id) on delete set null,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references crm_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function crm_generate_lead_id()
returns text
language plpgsql
as $$
declare
  active_rule lead_id_rules%rowtype;
  generated_id text;
begin
  select *
    into active_rule
    from lead_id_rules
    where is_active
    order by updated_at desc
    limit 1
    for update;

  if not found then
    insert into lead_id_rules (name, prefix, padding, next_number, include_year, is_active)
    values ('Default lead ID', 'L', 4, 1, false, true)
    on conflict (name) do update set is_active = true
    returning * into active_rule;
  end if;

  generated_id :=
    active_rule.prefix ||
    case
      when active_rule.include_year then to_char(now(), coalesce(active_rule.year_format, 'YYYY'))
      else ''
    end ||
    lpad(active_rule.next_number::text, active_rule.padding, '0');

  update lead_id_rules
    set next_number = next_number + 1,
        updated_at = now()
    where id = active_rule.id;

  return generated_id;
end;
$$;

create or replace function crm_generate_mrn()
returns text
language plpgsql
as $$
declare
  active_rule mrn_rules%rowtype;
  generated_mrn text;
begin
  select *
    into active_rule
    from mrn_rules
    where is_active
    order by updated_at desc
    limit 1
    for update;

  if not found then
    insert into mrn_rules (name, prefix, padding, next_number, include_year, is_active)
    values ('Default MRN', 'EC', 4, 1, false, true)
    on conflict (name) do update set is_active = true
    returning * into active_rule;
  end if;

  generated_mrn :=
    active_rule.prefix ||
    case
      when active_rule.include_year then to_char(now(), coalesce(active_rule.year_format, 'YYYY'))
      else ''
    end ||
    lpad(active_rule.next_number::text, active_rule.padding, '0');

  update mrn_rules
    set next_number = next_number + 1,
        updated_at = now()
    where id = active_rule.id;

  return generated_mrn;
end;
$$;

create or replace function crm_prepare_lead()
returns trigger
language plpgsql
as $$
begin
  if new.lead_id is null or trim(new.lead_id) = '' then
    new.lead_id := crm_generate_lead_id();
  end if;

  new.normalized_phone := crm_normalize_phone(coalesce(new.phone_country_code, '') || coalesce(new.phone_number, ''));
  new.normalized_chat_link := crm_normalize_text_identifier(new.chat_link);
  new.normalized_platform_id := crm_normalize_text_identifier(new.platform_id);
  return new;
end;
$$;

create or replace function crm_prepare_patient()
returns trigger
language plpgsql
as $$
begin
  if new.mrn is null or trim(new.mrn) = '' then
    new.mrn := crm_generate_mrn();
  end if;

  new.normalized_phone := crm_normalize_phone(coalesce(new.phone_country_code, '') || coalesce(new.phone_number, ''));
  return new;
end;
$$;

create or replace function crm_prepare_lead_source_link()
returns trigger
language plpgsql
as $$
begin
  new.normalized_chat_link := crm_normalize_text_identifier(new.chat_link);
  new.normalized_platform_id := crm_normalize_text_identifier(new.platform_id);
  return new;
end;
$$;

create or replace function crm_prepare_old_database_followup()
returns trigger
language plpgsql
as $$
begin
  new.normalized_phone := crm_normalize_phone(new.phone_number);
  return new;
end;
$$;

create or replace function crm_flag_duplicate_for_lead(target_lead_id uuid)
returns void
language plpgsql
as $$
declare
  target_lead leads%rowtype;
  match_record record;
begin
  select * into target_lead from leads where id = target_lead_id;
  if not found then
    return;
  end if;

  if target_lead.normalized_phone is not null then
    for match_record in
      select id from leads
      where id <> target_lead.id
        and normalized_phone = target_lead.normalized_phone
    loop
      insert into lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value)
      values (target_lead.id, match_record.id, 'phone', target_lead.normalized_phone)
      on conflict do nothing;
    end loop;
  end if;

  if target_lead.normalized_chat_link is not null then
    for match_record in
      select id from leads
      where id <> target_lead.id
        and normalized_chat_link = target_lead.normalized_chat_link
    loop
      insert into lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value)
      values (target_lead.id, match_record.id, 'chat_link', target_lead.normalized_chat_link)
      on conflict do nothing;
    end loop;
  end if;

  if target_lead.normalized_platform_id is not null then
    for match_record in
      select id from leads
      where id <> target_lead.id
        and normalized_platform_id = target_lead.normalized_platform_id
    loop
      insert into lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value)
      values (target_lead.id, match_record.id, 'platform_id', target_lead.normalized_platform_id)
      on conflict do nothing;
    end loop;
  end if;

  for match_record in
    select current_link.normalized_chat_link as identifier_value, other_link.lead_id as duplicate_lead_id
    from lead_source_links current_link
    join lead_source_links other_link
      on other_link.normalized_chat_link = current_link.normalized_chat_link
     and other_link.lead_id <> current_link.lead_id
    where current_link.lead_id = target_lead.id
      and current_link.normalized_chat_link is not null
  loop
    insert into lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value)
    values (target_lead.id, match_record.duplicate_lead_id, 'chat_link', match_record.identifier_value)
    on conflict do nothing;
  end loop;

  for match_record in
    select current_link.normalized_platform_id as identifier_value, other_link.lead_id as duplicate_lead_id
    from lead_source_links current_link
    join lead_source_links other_link
      on other_link.normalized_platform_id = current_link.normalized_platform_id
     and other_link.lead_id <> current_link.lead_id
    where current_link.lead_id = target_lead.id
      and current_link.normalized_platform_id is not null
  loop
    insert into lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value)
    values (target_lead.id, match_record.duplicate_lead_id, 'platform_id', match_record.identifier_value)
    on conflict do nothing;
  end loop;
end;
$$;

create or replace function crm_after_lead_duplicate_check()
returns trigger
language plpgsql
as $$
begin
  perform crm_flag_duplicate_for_lead(new.id);
  return new;
end;
$$;

create or replace function crm_after_source_link_duplicate_check()
returns trigger
language plpgsql
as $$
begin
  perform crm_flag_duplicate_for_lead(new.lead_id);
  return new;
end;
$$;

create or replace function crm_log_status_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into lead_status_history (lead_id, from_status, to_status, lost_reason_id)
    values (new.id, null, new.status, new.lost_reason_id);
  elsif old.status is distinct from new.status then
    insert into lead_status_history (lead_id, from_status, to_status, lost_reason_id)
    values (new.id, old.status, new.status, new.lost_reason_id);
  end if;

  return new;
end;
$$;

drop trigger if exists crm_settings_updated_at on crm_settings;
create trigger crm_settings_updated_at before update on crm_settings
  for each row execute function crm_update_updated_at();

drop trigger if exists crm_users_updated_at on crm_users;
create trigger crm_users_updated_at before update on crm_users
  for each row execute function crm_update_updated_at();

drop trigger if exists lead_id_rules_updated_at on lead_id_rules;
create trigger lead_id_rules_updated_at before update on lead_id_rules
  for each row execute function crm_update_updated_at();

drop trigger if exists mrn_rules_updated_at on mrn_rules;
create trigger mrn_rules_updated_at before update on mrn_rules
  for each row execute function crm_update_updated_at();

drop trigger if exists lead_sources_updated_at on lead_sources;
create trigger lead_sources_updated_at before update on lead_sources
  for each row execute function crm_update_updated_at();

drop trigger if exists patients_prepare on patients;
create trigger patients_prepare before insert or update on patients
  for each row execute function crm_prepare_patient();

drop trigger if exists patients_updated_at on patients;
create trigger patients_updated_at before update on patients
  for each row execute function crm_update_updated_at();

drop trigger if exists lost_reasons_updated_at on lost_reasons;
create trigger lost_reasons_updated_at before update on lost_reasons
  for each row execute function crm_update_updated_at();

drop trigger if exists leads_prepare on leads;
create trigger leads_prepare before insert or update on leads
  for each row execute function crm_prepare_lead();

drop trigger if exists leads_updated_at on leads;
create trigger leads_updated_at before update on leads
  for each row execute function crm_update_updated_at();

drop trigger if exists leads_duplicate_check on leads;
create trigger leads_duplicate_check after insert or update on leads
  for each row execute function crm_after_lead_duplicate_check();

drop trigger if exists leads_status_history on leads;
create trigger leads_status_history after insert or update of status on leads
  for each row execute function crm_log_status_change();

drop trigger if exists lead_custom_fields_updated_at on lead_custom_fields;
create trigger lead_custom_fields_updated_at before update on lead_custom_fields
  for each row execute function crm_update_updated_at();

drop trigger if exists lead_field_visibility_settings_updated_at on lead_field_visibility_settings;
create trigger lead_field_visibility_settings_updated_at before update on lead_field_visibility_settings
  for each row execute function crm_update_updated_at();

drop trigger if exists lead_source_links_prepare on lead_source_links;
create trigger lead_source_links_prepare before insert or update on lead_source_links
  for each row execute function crm_prepare_lead_source_link();

drop trigger if exists lead_source_links_updated_at on lead_source_links;
create trigger lead_source_links_updated_at before update on lead_source_links
  for each row execute function crm_update_updated_at();

drop trigger if exists lead_source_links_duplicate_check on lead_source_links;
create trigger lead_source_links_duplicate_check after insert or update on lead_source_links
  for each row execute function crm_after_source_link_duplicate_check();

drop trigger if exists lead_tags_updated_at on lead_tags;
create trigger lead_tags_updated_at before update on lead_tags
  for each row execute function crm_update_updated_at();

drop trigger if exists lead_duplicate_flags_updated_at on lead_duplicate_flags;
create trigger lead_duplicate_flags_updated_at before update on lead_duplicate_flags
  for each row execute function crm_update_updated_at();

drop trigger if exists old_database_followups_prepare on old_database_followups;
create trigger old_database_followups_prepare before insert or update on old_database_followups
  for each row execute function crm_prepare_old_database_followup();

drop trigger if exists old_database_followups_updated_at on old_database_followups;
create trigger old_database_followups_updated_at before update on old_database_followups
  for each row execute function crm_update_updated_at();

drop trigger if exists escalations_updated_at on escalations;
create trigger escalations_updated_at before update on escalations
  for each row execute function crm_update_updated_at();

alter table crm_settings enable row level security;
alter table crm_users enable row level security;
alter table lead_id_rules enable row level security;
alter table mrn_rules enable row level security;
alter table lead_sources enable row level security;
alter table patients enable row level security;
alter table lost_reasons enable row level security;
alter table leads enable row level security;
alter table lead_custom_fields enable row level security;
alter table lead_field_visibility_settings enable row level security;
alter table lead_status_history enable row level security;
alter table lead_timeline_events enable row level security;
alter table lead_messages enable row level security;
alter table lead_source_links enable row level security;
alter table lead_tags enable row level security;
alter table lead_tag_assignments enable row level security;
alter table lead_duplicate_flags enable row level security;
alter table duplicate_review_actions enable row level security;
alter table old_database_followups enable row level security;
alter table escalations enable row level security;
alter table audit_logs enable row level security;

create or replace function crm_has_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from crm_users
    where auth_user_id = auth.uid()
      and is_active
  );
$$;

-- Service role bypasses RLS. These starter policies let authenticated CRM users read
-- the foundation data while writes are expected to go through server APIs initially.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_settings', 'crm_users', 'lead_id_rules', 'mrn_rules', 'lead_sources',
    'patients', 'lost_reasons', 'leads', 'lead_custom_fields',
    'lead_field_visibility_settings', 'lead_status_history', 'lead_timeline_events',
    'lead_messages', 'lead_source_links', 'lead_tags', 'lead_tag_assignments',
    'lead_duplicate_flags', 'duplicate_review_actions', 'old_database_followups',
    'escalations', 'audit_logs'
  ]
  loop
    execute format('drop policy if exists "CRM active users can read" on %I', table_name);
    execute format(
      'create policy "CRM active users can read" on %I for select to authenticated using (crm_has_active_user())',
      table_name
    );
  end loop;
end $$;

insert into lead_id_rules (name, prefix, padding, next_number, include_year, is_active)
values ('Default lead ID', 'L', 4, 1, false, true)
on conflict (name) do nothing;

insert into mrn_rules (name, prefix, padding, next_number, include_year, is_active)
values ('Default MRN', 'EC', 4, 1, false, true)
on conflict (name) do nothing;

insert into crm_settings (key, value, description, is_editable)
values
  ('lead_statuses', '["new_lead","qualified","booked","follow_up","post_op_follow_up","lost"]'::jsonb, 'Main CRM lead pipeline statuses.', false),
  ('crm_roles', '["owner_admin","manager","moderator","doctor","viewer"]'::jsonb, 'CRM role names used by role-based navigation and permissions.', false),
  ('duplicate_identifiers', '["phone","chat_link","platform_id"]'::jsonb, 'Only these identifiers can automatically flag duplicates.', false),
  ('urgency_options', '["low","normal","high","urgent"]'::jsonb, 'Default urgency labels for leads.', true)
on conflict (key) do update set
  value = excluded.value,
  description = excluded.description,
  is_editable = excluded.is_editable,
  updated_at = now();

insert into lead_sources (key, label, source_type, display_order)
values
  ('facebook_messenger', 'Facebook Messenger', 'social', 10),
  ('instagram', 'Instagram', 'social', 20),
  ('whatsapp', 'WhatsApp', 'messaging', 30),
  ('manual', 'Manual entry', 'manual', 40)
on conflict (key) do update set
  label = excluded.label,
  source_type = excluded.source_type,
  display_order = excluded.display_order,
  updated_at = now();

insert into lost_reasons (label, display_order)
values
  ('No response', 10),
  ('Price issue', 20),
  ('Unavailable service', 30),
  ('Chose another clinic', 40)
on conflict (label) do update set
  display_order = excluded.display_order,
  updated_at = now();

insert into lead_tags (name, color)
values
  ('VIP', '#d4a63f'),
  ('Needs manager review', '#b45309'),
  ('Surgery interest', '#2563eb'),
  ('Old database', '#64748b')
on conflict (name) do update set
  color = excluded.color,
  updated_at = now();

insert into lead_custom_fields (field_key, label_ar, label_en, field_type, is_enabled, display_order)
values
  ('lead_id', 'ID', 'ID', 'text', true, 10),
  ('chat_link', 'رابط المحادثة', 'Chat Link', 'url', true, 20),
  ('qualification', 'التأهيل', 'Qualification', 'text', true, 30),
  ('arabic_status', 'الحالة', 'Status Label', 'text', true, 40),
  ('name', 'الاسم', 'Name', 'text', true, 50),
  ('coordinator_user_id', 'المنسق', 'Coordinator', 'relation', true, 60),
  ('first_contact_at', 'تاريخ اول تواصل', 'First Contact Date', 'datetime', true, 70),
  ('gender', 'النوع', 'Gender', 'select', true, 80),
  ('phone_number', 'رقم التليفون', 'Phone Number', 'phone', true, 90),
  ('source_id', 'المصدر', 'Source', 'relation', true, 100),
  ('service_name', 'الخدمة', 'Service', 'text', true, 110),
  ('doctor_id', 'الطبيب', 'Doctor', 'relation', true, 120),
  ('initial_price', 'السعر المبدأي', 'Initial Price', 'number', true, 130),
  ('next_step', 'الخطوة القادمة', 'Next Step', 'text', true, 140),
  ('notes', 'الملاحظات', 'Notes', 'textarea', true, 150),
  ('medical_notes', 'الملاحظات الطبية', 'Medical Notes', 'textarea', true, 160),
  ('medical_history', 'التاريخ المرضي', 'Medical History', 'textarea', true, 170),
  ('branch_id', 'الفرع', 'Branch', 'relation', true, 180),
  ('campaign', 'الحملة', 'Campaign', 'text', true, 190),
  ('ad_name', 'اسم الاعلان', 'Ad Name', 'text', true, 200),
  ('urgency', 'الاولوية', 'Urgency', 'select', true, 210),
  ('tags', 'الوسوم', 'Tags', 'relation', true, 220),
  ('escalation_status', 'حالة التصعيد', 'Escalation Status', 'select', true, 230)
on conflict (field_key) do update set
  label_ar = excluded.label_ar,
  label_en = excluded.label_en,
  field_type = excluded.field_type,
  is_enabled = excluded.is_enabled,
  display_order = excluded.display_order,
  updated_at = now();

insert into lead_field_visibility_settings (field_key, role, can_view, can_edit)
select field_key, role_name::crm_role, true,
  case
    when role_name in ('owner_admin', 'manager') then true
    when role_name = 'moderator' and field_key not in ('medical_notes', 'medical_history') then true
    else false
  end
from lead_custom_fields
cross join unnest(array['owner_admin', 'manager', 'moderator', 'doctor', 'viewer']) as role_name
on conflict (field_key, role) do update set
  can_view = excluded.can_view,
  can_edit = excluded.can_edit,
  updated_at = now();

-- Optional fixtures for explicitly marked development/test databases only.
-- A missing environment setting is production-safe and inserts nothing.
do $$
begin
if coalesce(current_setting('app.environment', true), '') in ('development', 'test') then

insert into leads (
  status,
  chat_link,
  platform,
  qualification,
  arabic_status,
  name,
  gender,
  phone_country_code,
  phone_number,
  source_id,
  service_name,
  initial_price,
  next_step,
  notes,
  branch_id,
  campaign,
  ad_name,
  urgency,
  metadata
)
select
  'new_lead',
  'https://example.com/chat/demo-lead-1',
  'instagram',
  'Interested in consultation',
  'عميل جديد',
  'Demo CRM Lead',
  'female',
  '+20',
  '01000000000',
  lead_sources.id,
  'Consultation',
  0,
  'Call back',
  'Safe sample record for CRM UI testing.',
  null,
  'demo',
  'launch-demo',
  'normal',
  '{"seed": true}'::jsonb
from lead_sources
where lead_sources.key = 'instagram'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/demo-lead-1');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/phone-a', 'facebook_messenger', 'demo-phone-a', 'Duplicate Phone A', '+20', '01011111111', lead_sources.id, 'Consultation', 'Duplicate seed: same phone.', '{"seed": true, "duplicate_scenario": "same_phone"}'::jsonb
from lead_sources
where lead_sources.key = 'facebook_messenger'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/phone-a');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/phone-b', 'instagram', 'demo-phone-b', 'Duplicate Phone B', '+20', '01011111111', lead_sources.id, 'Consultation', 'Duplicate seed: same phone.', '{"seed": true, "duplicate_scenario": "same_phone"}'::jsonb
from lead_sources
where lead_sources.key = 'instagram'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/phone-b');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/shared-link', 'facebook_messenger', 'demo-chat-a', 'Duplicate Chat A', '+20', '01022222221', lead_sources.id, 'Botox', 'Duplicate seed: same chat link.', '{"seed": true, "duplicate_scenario": "same_chat_link"}'::jsonb
from lead_sources
where lead_sources.key = 'facebook_messenger'
  and not exists (select 1 from leads where platform_id = 'demo-chat-a');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/shared-link', 'instagram', 'demo-chat-b', 'Duplicate Chat B', '+20', '01022222222', lead_sources.id, 'Botox', 'Duplicate seed: same chat link.', '{"seed": true, "duplicate_scenario": "same_chat_link"}'::jsonb
from lead_sources
where lead_sources.key = 'instagram'
  and not exists (select 1 from leads where platform_id = 'demo-chat-b');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/platform-a', 'facebook_messenger', 'shared-platform-id', 'Duplicate Platform A', '+20', '01033333331', lead_sources.id, 'Consultation', 'Duplicate seed: same platform ID.', '{"seed": true, "duplicate_scenario": "same_platform_id"}'::jsonb
from lead_sources
where lead_sources.key = 'facebook_messenger'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/platform-a');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/platform-b', 'instagram', 'shared-platform-id', 'Duplicate Platform B', '+20', '01033333332', lead_sources.id, 'Consultation', 'Duplicate seed: same platform ID.', '{"seed": true, "duplicate_scenario": "same_platform_id"}'::jsonb
from lead_sources
where lead_sources.key = 'instagram'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/platform-b');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/same-name-a', 'manual', 'same-name-a', 'Same Name Test', '+20', '01044444441', lead_sources.id, 'Consultation', 'Same name only should not be duplicate.', '{"seed": true, "duplicate_scenario": "same_name_not_duplicate"}'::jsonb
from lead_sources
where lead_sources.key = 'manual'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/same-name-a');

insert into leads (status, chat_link, platform, platform_id, name, phone_country_code, phone_number, source_id, service_name, notes, metadata)
select 'new_lead', 'https://example.com/chat/same-name-b', 'manual', 'same-name-b', 'Same Name Test', '+20', '01044444442', lead_sources.id, 'Consultation', 'Same name only should not be duplicate.', '{"seed": true, "duplicate_scenario": "same_name_not_duplicate"}'::jsonb
from lead_sources
where lead_sources.key = 'manual'
  and not exists (select 1 from leads where chat_link = 'https://example.com/chat/same-name-b');

end if;
end $$;
