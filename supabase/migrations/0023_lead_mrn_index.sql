-- Local clinic MRN: a 1–9 digit patient record number stored on the lead and
-- used as a fast, unique bulk-import match key.
set search_path = public, extensions;

create index if not exists leads_mrn_lookup_idx on public.leads (mrn) where mrn is not null;

do $$
begin
  if not exists (
    select 1 from public.leads where mrn is not null group by mrn having count(*) > 1
  ) then
    create unique index if not exists leads_mrn_unique_idx on public.leads (mrn) where mrn is not null;
  else
    raise warning 'Duplicate MRNs exist; leads_mrn_unique_idx was not created. Resolve duplicates in CRM Database.';
  end if;
end $$;
