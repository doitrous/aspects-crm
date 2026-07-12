-- Local CRM dismissal state for reservations that should remain in the booking
-- platform but no longer appear in the Website Reservations review queue.
set search_path = public, extensions;

create table if not exists public.crm_dismissed_website_reservations (
  appointment_id uuid primary key,
  dismissed_by uuid references public.crm_users(id) on delete set null,
  dismissed_at timestamptz not null default now()
);

create index if not exists crm_dismissed_website_reservations_at_idx
  on public.crm_dismissed_website_reservations (dismissed_at desc);

alter table public.crm_dismissed_website_reservations enable row level security;

drop policy if exists "CRM active users can read" on public.crm_dismissed_website_reservations;
create policy "CRM active users can read" on public.crm_dismissed_website_reservations
  for select to authenticated using (public.crm_has_active_user());

grant select on public.crm_dismissed_website_reservations to authenticated;
grant all on public.crm_dismissed_website_reservations to service_role;
