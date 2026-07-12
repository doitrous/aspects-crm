-- Prevent short or partial patient names from creating false duplicate flags.
-- Exact identifiers (phone, chat link, and platform ID) remain unaffected.
set search_path = public, extensions;

create or replace function public.crm_normalize_person_name(input_name text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(lower(coalesce(input_name, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

create or replace function public.crm_person_name_part_count(input_name text)
returns integer
language sql
immutable
parallel safe
as $$
  select count(*)::integer
  from unnest(regexp_split_to_array(public.crm_normalize_person_name(input_name), '[[:space:]]+')) as part
  where char_length(part) >= 2;
$$;

create or replace function public.crm_names_are_duplicate_candidates(first_name text, second_name text)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    public.crm_person_name_part_count(first_name) >= 3
    and public.crm_person_name_part_count(second_name) >= 3
    and similarity(
      public.crm_normalize_person_name(first_name),
      public.crm_normalize_person_name(second_name)
    ) >= 0.82;
$$;

alter table public.lead_duplicate_flags
  drop constraint if exists lead_duplicate_flags_duplicate_type_check;

alter table public.lead_duplicate_flags
  add constraint lead_duplicate_flags_duplicate_type_check
  check (duplicate_type in ('phone', 'chat_link', 'platform_id', 'name'));

-- Remove only unresolved false-positive name flags. Reviewed history is retained.
delete from public.lead_duplicate_flags as flag
using public.leads as first_lead, public.leads as second_lead
where flag.duplicate_type = 'name'
  and flag.status = 'pending'
  and first_lead.id = flag.lead_id
  and second_lead.id = flag.duplicate_lead_id
  and not public.crm_names_are_duplicate_candidates(first_lead.name, second_lead.name);

create or replace function public.crm_flag_duplicate_for_lead(target_lead_id uuid)
returns void
language plpgsql
as $$
declare
  target_lead public.leads%rowtype;
  match_record record;
begin
  select * into target_lead from public.leads where id = target_lead_id;
  if not found then
    return;
  end if;

  -- If a name was shortened or corrected, clear obsolete unresolved name flags
  -- involving this lead before calculating the current candidates.
  delete from public.lead_duplicate_flags as flag
  using public.leads as first_lead, public.leads as second_lead
  where flag.duplicate_type = 'name'
    and flag.status = 'pending'
    and (flag.lead_id = target_lead.id or flag.duplicate_lead_id = target_lead.id)
    and first_lead.id = flag.lead_id
    and second_lead.id = flag.duplicate_lead_id
    and not public.crm_names_are_duplicate_candidates(first_lead.name, second_lead.name);

  if target_lead.normalized_phone is not null then
    for match_record in
      select id from public.leads
      where id <> target_lead.id
        and normalized_phone = target_lead.normalized_phone
    loop
      insert into public.lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score)
      values (target_lead.id, match_record.id, 'phone', target_lead.normalized_phone, 1)
      on conflict do nothing;
    end loop;
  end if;

  if target_lead.normalized_chat_link is not null then
    for match_record in
      select id from public.leads
      where id <> target_lead.id
        and normalized_chat_link = target_lead.normalized_chat_link
    loop
      insert into public.lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score)
      values (target_lead.id, match_record.id, 'chat_link', target_lead.normalized_chat_link, 1)
      on conflict do nothing;
    end loop;
  end if;

  if target_lead.normalized_platform_id is not null then
    for match_record in
      select id from public.leads
      where id <> target_lead.id
        and normalized_platform_id = target_lead.normalized_platform_id
    loop
      insert into public.lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score)
      values (target_lead.id, match_record.id, 'platform_id', target_lead.normalized_platform_id, 1)
      on conflict do nothing;
    end loop;
  end if;

  for match_record in
    select current_link.normalized_chat_link as identifier_value, other_link.lead_id as duplicate_lead_id
    from public.lead_source_links as current_link
    join public.lead_source_links as other_link
      on other_link.normalized_chat_link = current_link.normalized_chat_link
     and other_link.lead_id <> current_link.lead_id
    where current_link.lead_id = target_lead.id
      and current_link.normalized_chat_link is not null
  loop
    insert into public.lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score)
    values (target_lead.id, match_record.duplicate_lead_id, 'chat_link', match_record.identifier_value, 1)
    on conflict do nothing;
  end loop;

  for match_record in
    select current_link.normalized_platform_id as identifier_value, other_link.lead_id as duplicate_lead_id
    from public.lead_source_links as current_link
    join public.lead_source_links as other_link
      on other_link.normalized_platform_id = current_link.normalized_platform_id
     and other_link.lead_id <> current_link.lead_id
    where current_link.lead_id = target_lead.id
      and current_link.normalized_platform_id is not null
  loop
    insert into public.lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score)
    values (target_lead.id, match_record.duplicate_lead_id, 'platform_id', match_record.identifier_value, 1)
    on conflict do nothing;
  end loop;

  -- A name is only a review signal when both records have full, three-part names.
  if public.crm_person_name_part_count(target_lead.name) >= 3 then
    for match_record in
      select
        id,
        public.crm_normalize_person_name(name) as identifier_value,
        similarity(
          public.crm_normalize_person_name(target_lead.name),
          public.crm_normalize_person_name(name)
        ) as name_confidence
      from public.leads
      where id <> target_lead.id
        and public.crm_names_are_duplicate_candidates(target_lead.name, name)
    loop
      insert into public.lead_duplicate_flags (lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score)
      values (
        target_lead.id,
        match_record.id,
        'name',
        match_record.identifier_value,
        least(1, greatest(0, match_record.name_confidence))
      )
      on conflict do nothing;
    end loop;
  end if;
end;
$$;

grant execute on function public.crm_normalize_person_name(text) to service_role;
grant execute on function public.crm_person_name_part_count(text) to service_role;
grant execute on function public.crm_names_are_duplicate_candidates(text, text) to service_role;
grant execute on function public.crm_flag_duplicate_for_lead(uuid) to service_role;
