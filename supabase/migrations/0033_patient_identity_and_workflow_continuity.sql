-- Patient identity continuity, multi-phone support and status-independent follow-up history.

set search_path = public, extensions;

alter table public.lead_duplicate_flags drop constraint if exists lead_duplicate_flags_duplicate_type_check;
alter table public.lead_duplicate_flags add constraint lead_duplicate_flags_duplicate_type_check
  check (duplicate_type in ('mrn','lead_id','phone','platform_id','unique_id','chat_link','name'));

create table if not exists public.crm_lead_phones (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  country_code text,
  phone_number text not null,
  normalized_phone text not null,
  label text not null default 'Mobile',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, normalized_phone)
);

create unique index if not exists crm_lead_phones_one_primary_idx
  on public.crm_lead_phones (lead_id) where is_primary;
create index if not exists crm_lead_phones_identity_idx
  on public.crm_lead_phones (normalized_phone);

insert into public.crm_lead_phones (lead_id, country_code, phone_number, normalized_phone, is_primary)
select id, phone_country_code, coalesce(phone_number, normalized_phone), normalized_phone, true
from public.leads
where normalized_phone is not null and normalized_phone <> ''
on conflict (lead_id, normalized_phone) do update set is_primary = true;

create table if not exists public.crm_lead_links (
  id uuid primary key default gen_random_uuid(),
  lead_a_id uuid not null references public.leads(id) on delete cascade,
  lead_b_id uuid not null references public.leads(id) on delete cascade,
  relationship text not null default 'same_patient' check (relationship in ('same_patient','family')),
  linked_by uuid references public.crm_users(id) on delete set null,
  linked_at timestamptz not null default now(),
  notes text,
  check (lead_a_id < lead_b_id),
  unique (lead_a_id, lead_b_id, relationship)
);

create index if not exists crm_lead_links_a_idx on public.crm_lead_links (lead_a_id);
create index if not exists crm_lead_links_b_idx on public.crm_lead_links (lead_b_id);

insert into public.crm_lead_links (lead_a_id, lead_b_id, relationship, linked_by, linked_at, notes)
select least(lead_id, duplicate_lead_id), greatest(lead_id, duplicate_lead_id), 'same_patient', reviewed_by,
       coalesce(reviewed_at, updated_at, now()), notes
from public.lead_duplicate_flags where status = 'linked'
on conflict (lead_a_id, lead_b_id, relationship) do nothing;

-- Existing "link identities" decisions now create a durable relationship while
-- leaving both source records and every channel event untouched.
create or replace function public.crm_sync_linked_duplicate()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if new.status = 'linked' and old.status is distinct from new.status then
    insert into public.crm_lead_links (lead_a_id, lead_b_id, relationship, linked_by, notes)
    values (least(new.lead_id, new.duplicate_lead_id), greatest(new.lead_id, new.duplicate_lead_id), 'same_patient', new.reviewed_by, new.notes)
    on conflict (lead_a_id, lead_b_id, relationship) do update
      set linked_by = excluded.linked_by, linked_at = now(), notes = excluded.notes;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_duplicate_flags_sync_link on public.lead_duplicate_flags;
create trigger lead_duplicate_flags_sync_link
after update of status on public.lead_duplicate_flags
for each row execute function public.crm_sync_linked_duplicate();

create table if not exists public.crm_followup_programs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  workflow_type text not null check (workflow_type in ('follow_up','post_op')),
  name text not null,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.lead_follow_up_stages
  add column if not exists program_id uuid references public.crm_followup_programs(id) on delete set null;

create index if not exists crm_followup_programs_lead_idx
  on public.crm_followup_programs (lead_id, started_at desc);
create index if not exists lead_follow_up_stages_program_idx
  on public.lead_follow_up_stages (program_id, stage_number);

-- One source of truth means imported patients count as soon as their actual
-- status places them in an operational queue.
create or replace function public.crm_dashboard_metrics()
returns jsonb language sql stable set search_path = public, extensions as $$
  with lead_metrics as (
    select
      count(*) filter (where status = 'new_lead') as new_leads,
      count(*) filter (where has_unread) as unread,
      count(*) filter (where is_reply_overdue) as overdue,
      count(*) filter (where status = 'qualified') as qualified,
      count(*) filter (where status = 'booked') as booked,
      count(*) filter (where status = 'follow_up') as follow_up,
      count(*) filter (where status = 'lost') as lost,
      count(*) filter (where booking_appointment_id is not null) as appointments
    from public.leads where merged_into_lead_id is null
  ), duplicate_metrics as (
    select count(distinct lead_id) as duplicates from (
      select lead_id from public.lead_duplicate_flags where status not in ('linked','merged','dismissed')
      union select duplicate_lead_id from public.lead_duplicate_flags where status not in ('linked','merged','dismissed')
    ) d
  ), escalation_metrics as (
    select count(*) as escalations from public.escalations where status <> 'resolved'
  )
  select jsonb_build_object('newLeads',new_leads,'unread',unread,'overdue',overdue,
    'qualified',qualified,'booked',booked,'followUp',follow_up,'lost',lost,
    'appointments',appointments,'duplicates',duplicates,'escalations',escalations)
  from lead_metrics, duplicate_metrics, escalation_metrics;
$$;

revoke all on table public.crm_lead_phones, public.crm_lead_links, public.crm_followup_programs from public, anon, authenticated;
grant all on table public.crm_lead_phones, public.crm_lead_links, public.crm_followup_programs to service_role;
revoke all on function public.crm_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.crm_dashboard_metrics() to service_role;
