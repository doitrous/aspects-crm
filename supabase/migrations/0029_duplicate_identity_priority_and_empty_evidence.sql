-- Make duplicate detection identity-first and reject empty evidence globally.
--
-- Priority identities are MRN, Lead ID, phone, platform ID, then another
-- external/patient unique ID. Name similarity remains a lower-confidence hint
-- and is already restricted to full three-part names by migration 0024.

set search_path = public, extensions;

alter table public.lead_duplicate_flags
  drop constraint if exists lead_duplicate_flags_duplicate_type_check;

alter table public.lead_duplicate_flags
  add constraint lead_duplicate_flags_duplicate_type_check
  check (duplicate_type in (
    'mrn',
    'lead_id',
    'phone',
    'platform_id',
    'unique_id',
    'chat_link',
    'name'
  ));

alter table public.lead_duplicate_flags
  add column if not exists match_priority smallint generated always as (
    case duplicate_type
      when 'mrn' then 1
      when 'lead_id' then 2
      when 'phone' then 3
      when 'platform_id' then 4
      when 'unique_id' then 5
      when 'chat_link' then 6
      when 'name' then 7
      else 99
    end
  ) stored;

create index if not exists lead_duplicate_flags_review_priority_idx
  on public.lead_duplicate_flags (status, match_priority, created_at desc);

-- One guard protects every producer of duplicate flags: database triggers,
-- imports, webhook ingestion and future server-side code. Empty strings are
-- never identities, and phone placeholders must contain at least five digits.
create or replace function public.crm_validate_duplicate_evidence()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.identifier_value := nullif(btrim(new.identifier_value), '');

  if new.identifier_value is null then
    return null;
  end if;

  if new.duplicate_type = 'phone'
     and char_length(regexp_replace(new.identifier_value, '\D', '', 'g')) <= 4 then
    return null;
  end if;

  return new;
end;
$$;

drop trigger if exists lead_duplicate_flags_ignore_short_phone on public.lead_duplicate_flags;
drop trigger if exists lead_duplicate_flags_validate_evidence on public.lead_duplicate_flags;
create trigger lead_duplicate_flags_validate_evidence
before insert or update of duplicate_type, identifier_value
on public.lead_duplicate_flags
for each row execute function public.crm_validate_duplicate_evidence();

-- Only unresolved false positives are removed; reviewed decisions remain part
-- of the audit history.
delete from public.lead_duplicate_flags
where status = 'pending'
  and (
    nullif(btrim(identifier_value), '') is null
    or (
      duplicate_type = 'phone'
      and char_length(regexp_replace(identifier_value, '\D', '', 'g')) <= 4
    )
  );

create index if not exists leads_normalized_mrn_identity_idx
  on public.leads (lower(btrim(mrn)))
  where nullif(btrim(mrn), '') is not null
    and merged_into_lead_id is null;

create index if not exists leads_normalized_lead_id_identity_idx
  on public.leads (lower(btrim(lead_id)))
  where nullif(btrim(lead_id), '') is not null
    and merged_into_lead_id is null;

create index if not exists leads_patient_identity_idx
  on public.leads (patient_id)
  where patient_id is not null
    and merged_into_lead_id is null;

create or replace function public.crm_lead_external_unique_id(lead_metadata jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    nullif(lower(btrim(lead_metadata ->> 'unique_id')), ''),
    nullif(lower(btrim(lead_metadata ->> 'external_id')), ''),
    nullif(lower(btrim(lead_metadata ->> 'patient_unique_id')), ''),
    nullif(lower(btrim(lead_metadata ->> 'platform_user_id')), '')
  );
$$;

create index if not exists leads_external_unique_identity_idx
  on public.leads (public.crm_lead_external_unique_id(metadata))
  where public.crm_lead_external_unique_id(metadata) is not null
    and merged_into_lead_id is null;

create or replace function public.crm_flag_priority_identifiers(target_lead_id uuid)
returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  target_lead public.leads%rowtype;
  normalized_mrn text;
  normalized_lead_id text;
  external_unique_id text;
begin
  select * into target_lead
  from public.leads
  where id = target_lead_id
    and merged_into_lead_id is null;

  if not found then
    return;
  end if;

  normalized_mrn := nullif(lower(btrim(target_lead.mrn)), '');
  normalized_lead_id := nullif(lower(btrim(target_lead.lead_id)), '');
  external_unique_id := public.crm_lead_external_unique_id(target_lead.metadata);

  -- Clear obsolete unresolved priority flags involving the changed record.
  delete from public.lead_duplicate_flags as flag
  where flag.status = 'pending'
    and flag.duplicate_type in ('mrn', 'lead_id', 'unique_id')
    and (flag.lead_id = target_lead.id or flag.duplicate_lead_id = target_lead.id)
    and not exists (
      select 1
      from public.leads as first_lead
      join public.leads as second_lead on second_lead.id = flag.duplicate_lead_id
      where first_lead.id = flag.lead_id
        and first_lead.merged_into_lead_id is null
        and second_lead.merged_into_lead_id is null
        and (
          (flag.duplicate_type = 'mrn'
            and nullif(lower(btrim(first_lead.mrn)), '') is not null
            and lower(btrim(first_lead.mrn)) = lower(btrim(second_lead.mrn)))
          or
          (flag.duplicate_type = 'lead_id'
            and nullif(lower(btrim(first_lead.lead_id)), '') is not null
            and lower(btrim(first_lead.lead_id)) = lower(btrim(second_lead.lead_id)))
          or
          (flag.duplicate_type = 'unique_id' and (
            (first_lead.patient_id is not null and first_lead.patient_id = second_lead.patient_id)
            or (
              public.crm_lead_external_unique_id(first_lead.metadata) is not null
              and public.crm_lead_external_unique_id(first_lead.metadata)
                = public.crm_lead_external_unique_id(second_lead.metadata)
            )
          ))
        )
    );

  if normalized_mrn is not null then
    insert into public.lead_duplicate_flags (
      lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
    )
    select target_lead.id, candidate.id, 'mrn', normalized_mrn, 1
    from public.leads as candidate
    where candidate.id <> target_lead.id
      and candidate.merged_into_lead_id is null
      and lower(btrim(candidate.mrn)) = normalized_mrn
    on conflict do nothing;
  end if;

  -- Exact lead IDs are unique by schema. This normalized check safely catches
  -- legacy/imported casing or whitespace variants if they exist.
  if normalized_lead_id is not null then
    insert into public.lead_duplicate_flags (
      lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
    )
    select target_lead.id, candidate.id, 'lead_id', normalized_lead_id, 1
    from public.leads as candidate
    where candidate.id <> target_lead.id
      and candidate.merged_into_lead_id is null
      and lower(btrim(candidate.lead_id)) = normalized_lead_id
    on conflict do nothing;
  end if;

  if target_lead.patient_id is not null then
    insert into public.lead_duplicate_flags (
      lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
    )
    select target_lead.id, candidate.id, 'unique_id', 'patient:' || target_lead.patient_id::text, 1
    from public.leads as candidate
    where candidate.id <> target_lead.id
      and candidate.merged_into_lead_id is null
      and candidate.patient_id = target_lead.patient_id
    on conflict do nothing;
  end if;

  if external_unique_id is not null then
    insert into public.lead_duplicate_flags (
      lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
    )
    select target_lead.id, candidate.id, 'unique_id', external_unique_id, 1
    from public.leads as candidate
    where candidate.id <> target_lead.id
      and candidate.merged_into_lead_id is null
      and public.crm_lead_external_unique_id(candidate.metadata) = external_unique_id
    on conflict do nothing;
  end if;
end;
$$;

create or replace function public.crm_flag_priority_identifiers_trigger()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform public.crm_flag_priority_identifiers(new.id);
  return new;
end;
$$;

drop trigger if exists leads_priority_duplicate_check on public.leads;
create trigger leads_priority_duplicate_check
after insert or update of mrn, lead_id, patient_id, metadata
on public.leads
for each row execute function public.crm_flag_priority_identifiers_trigger();

-- Backfill the new identity rules for existing active records.
do $$
declare
  lead_record record;
begin
  for lead_record in
    select id from public.leads where merged_into_lead_id is null
  loop
    perform public.crm_flag_priority_identifiers(lead_record.id);
  end loop;
end;
$$;

revoke all on function public.crm_validate_duplicate_evidence() from public, anon, authenticated;
revoke all on function public.crm_lead_external_unique_id(jsonb) from public, anon, authenticated;
revoke all on function public.crm_flag_priority_identifiers(uuid) from public, anon, authenticated;
revoke all on function public.crm_flag_priority_identifiers_trigger() from public, anon, authenticated;
grant execute on function public.crm_lead_external_unique_id(jsonb) to service_role;
grant execute on function public.crm_flag_priority_identifiers(uuid) to service_role;
