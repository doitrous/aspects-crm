-- Foundational CRM persistence hardening.
--
-- Additive-only migration. These columns are already referenced by the CRM
-- adapter but are not guaranteed by the restored baseline files.

set search_path = public, extensions;

alter table public.lead_duplicate_flags
  add column if not exists confidence_score numeric not null default 0.8
  check (confidence_score >= 0 and confidence_score <= 1);

alter table public.escalations
  add column if not exists severity text not null default 'medium'
  check (severity in ('low', 'medium', 'high', 'critical'));

create index if not exists escalations_severity_idx
  on public.escalations(severity);

insert into public.lead_sources (key, label, source_type, display_order)
values ('website_booking', 'Website booking', 'booking', 35)
on conflict (key) do update set
  label = excluded.label,
  source_type = excluded.source_type,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();
