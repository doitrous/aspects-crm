-- CRM-owned scheduling. These rows intentionally do not reference or mutate the
-- booking/Admin scheduling tables, which live in a different Supabase project.
set search_path = public, extensions;

create table if not exists public.crm_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  doctor_name text not null,
  branch_id uuid not null,
  branch_name text not null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  slot_duration_minutes integer not null default 20 check (slot_duration_minutes between 5 and 240),
  first_come_first_serve boolean not null default false,
  first_come_capacity integer not null default 10 check (first_come_capacity > 0),
  effective_from date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create table if not exists public.crm_rooms (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null,
  branch_name text not null,
  name_en text not null,
  name_ar text,
  room_type text not null default 'clinic',
  is_active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, name_en)
);

-- Safe when this migration was applied during an earlier development pass.
alter table public.crm_schedule_templates add column if not exists first_come_first_serve boolean not null default false;
alter table public.crm_schedule_templates add column if not exists first_come_capacity integer not null default 10;

create table if not exists public.crm_schedule_room_assignments (
  id uuid primary key default gen_random_uuid(),
  schedule_template_id uuid not null references public.crm_schedule_templates(id) on delete cascade,
  room_id uuid not null references public.crm_rooms(id) on delete restrict,
  room_name text not null,
  created_at timestamptz not null default now(),
  unique (schedule_template_id),
  unique (schedule_template_id, room_id)
);

create table if not exists public.crm_schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  doctor_name text not null,
  branch_id uuid not null,
  branch_name text not null,
  exception_date date not null,
  start_time time,
  end_time time,
  room_id uuid,
  room_name text,
  exception_type text not null check (exception_type in ('available','unavailable','modified')),
  reason text,
  is_active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time is null or end_time is null or end_time > start_time)
);

create table if not exists public.crm_closures (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  scope text not null check (scope in ('organization','branch','room')),
  branch_id uuid,
  branch_name text,
  room_id uuid,
  room_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  recurrence jsonb not null default '{}'::jsonb,
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((scope <> 'branch') or branch_id is not null),
  check ((scope <> 'room') or room_id is not null)
);

create table if not exists public.crm_time_off (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  doctor_name text not null,
  branch_id uuid,
  branch_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  notes text,
  status text not null default 'approved' check (status in ('pending','approved','rejected','cancelled')),
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists crm_schedule_doctor_branch_day_idx on public.crm_schedule_templates (doctor_id, branch_id, day_of_week) where is_active;
create index if not exists crm_rooms_branch_idx on public.crm_rooms (branch_id, is_active, name_en);
create index if not exists crm_schedule_room_idx on public.crm_schedule_room_assignments (room_id);
create index if not exists crm_schedule_exception_date_idx on public.crm_schedule_exceptions (exception_date, doctor_id, branch_id) where is_active;
create index if not exists crm_closure_window_idx on public.crm_closures (starts_at, ends_at) where is_active;
create index if not exists crm_time_off_doctor_window_idx on public.crm_time_off (doctor_id, starts_at, ends_at) where status in ('pending','approved');

create or replace function public.crm_prevent_room_schedule_overlap()
returns trigger language plpgsql as $$
declare candidate public.crm_schedule_templates%rowtype;
begin
  select * into candidate from public.crm_schedule_templates where id = new.schedule_template_id;
  if candidate.is_active and exists (
    select 1
    from public.crm_schedule_room_assignments assignment
    join public.crm_schedule_templates schedule on schedule.id = assignment.schedule_template_id
    where assignment.room_id = new.room_id
      and assignment.schedule_template_id <> new.schedule_template_id
      and schedule.is_active
      and schedule.branch_id = candidate.branch_id
      and schedule.day_of_week = candidate.day_of_week
      and schedule.start_time < candidate.end_time
      and schedule.end_time > candidate.start_time
      and (schedule.effective_to is null or candidate.effective_from is null or schedule.effective_to >= candidate.effective_from)
      and (candidate.effective_to is null or schedule.effective_from is null or candidate.effective_to >= schedule.effective_from)
  ) then
    raise exception 'Room is already assigned to an overlapping CRM schedule.' using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists crm_room_schedule_conflict on public.crm_schedule_room_assignments;
create trigger crm_room_schedule_conflict before insert or update on public.crm_schedule_room_assignments
for each row execute function public.crm_prevent_room_schedule_overlap();

-- Updating an already-assigned schedule must be checked before the schedule row
-- changes. This avoids leaving an invalid overlap if a later assignment upsert
-- is rejected in a separate API request.
create or replace function public.crm_prevent_assigned_schedule_overlap()
returns trigger language plpgsql as $$
declare assigned_room_id uuid;
begin
  select room_id into assigned_room_id
  from public.crm_schedule_room_assignments
  where schedule_template_id = new.id;

  if new.is_active and assigned_room_id is not null and exists (
    select 1
    from public.crm_schedule_room_assignments assignment
    join public.crm_schedule_templates schedule on schedule.id = assignment.schedule_template_id
    where assignment.room_id = assigned_room_id
      and assignment.schedule_template_id <> new.id
      and schedule.is_active
      and schedule.branch_id = new.branch_id
      and schedule.day_of_week = new.day_of_week
      and schedule.start_time < new.end_time
      and schedule.end_time > new.start_time
      and (schedule.effective_to is null or new.effective_from is null or schedule.effective_to >= new.effective_from)
      and (new.effective_to is null or schedule.effective_from is null or new.effective_to >= schedule.effective_from)
  ) then
    raise exception 'Room is already assigned to an overlapping CRM schedule.' using errcode = '23P01';
  end if;
  return new;
end $$;

drop trigger if exists crm_assigned_schedule_conflict on public.crm_schedule_templates;
create trigger crm_assigned_schedule_conflict
before update of branch_id, day_of_week, start_time, end_time, effective_from, effective_to, is_active
on public.crm_schedule_templates for each row execute function public.crm_prevent_assigned_schedule_overlap();

do $$ declare table_name text; begin
  foreach table_name in array array['crm_rooms','crm_schedule_templates','crm_schedule_room_assignments','crm_schedule_exceptions','crm_closures','crm_time_off'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "CRM active users can read" on public.%I', table_name);
    execute format('create policy "CRM active users can read" on public.%I for select to authenticated using (crm_has_active_user())', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all privileges on public.%I to service_role', table_name);
  end loop;
end $$;
