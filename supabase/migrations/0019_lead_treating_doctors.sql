create table if not exists public.crm_lead_treating_doctors (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  doctor_id uuid not null,
  doctor_name text not null,
  specialty_id uuid,
  specialty_name text,
  service_id uuid,
  service_name text,
  bundle_id uuid references public.crm_financial_bundles(id) on delete set null,
  is_primary boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.crm_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (lead_id, doctor_id, service_id)
);

create index if not exists crm_lead_treating_doctors_lead_idx on public.crm_lead_treating_doctors (lead_id, active, is_primary desc);
create index if not exists crm_lead_treating_doctors_doctor_idx on public.crm_lead_treating_doctors (doctor_id, active);
alter table public.crm_lead_treating_doctors enable row level security;
grant select on public.crm_lead_treating_doctors to authenticated;
grant all privileges on public.crm_lead_treating_doctors to service_role;
drop policy if exists crm_lead_treating_doctors_read on public.crm_lead_treating_doctors;
create policy crm_lead_treating_doctors_read on public.crm_lead_treating_doctors for select to authenticated using (public.crm_has_active_user());
