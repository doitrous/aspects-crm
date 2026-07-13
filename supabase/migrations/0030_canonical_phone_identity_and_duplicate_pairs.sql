-- Treat formatting variants of the same phone as one patient identity and
-- store duplicate pairs in a single canonical direction.

set search_path = public, extensions;

create or replace function public.crm_normalize_phone(input_value text)
returns text
language sql
immutable
parallel safe
as $$
  with normalized as (
    select regexp_replace(coalesce(input_value, ''), '[^0-9]+', '', 'g') as digits
  )
  select case
    when char_length(digits) <= 4 then null
    when char_length(digits) >= 7 then right(digits, 9)
    else digits
  end
  from normalized;
$$;

-- Every duplicate producer passes through this guard. Ordering the UUIDs
-- prevents A→B and B→A from appearing as two review items.
create or replace function public.crm_canonicalize_duplicate_pair()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  swap_id uuid;
begin
  if new.lead_id > new.duplicate_lead_id then
    swap_id := new.lead_id;
    new.lead_id := new.duplicate_lead_id;
    new.duplicate_lead_id := swap_id;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_duplicate_flags_canonical_pair on public.lead_duplicate_flags;
create trigger lead_duplicate_flags_canonical_pair
before insert or update of lead_id, duplicate_lead_id
on public.lead_duplicate_flags
for each row execute function public.crm_canonicalize_duplicate_pair();

-- A reviewed decision wins over an unresolved inverse copy.
delete from public.lead_duplicate_flags as pending
where pending.status = 'pending'
  and exists (
    select 1
    from public.lead_duplicate_flags as reviewed
    where reviewed.status <> 'pending'
      and reviewed.duplicate_type = pending.duplicate_type
      and reviewed.identifier_value = pending.identifier_value
      and least(reviewed.lead_id, reviewed.duplicate_lead_id)
        = least(pending.lead_id, pending.duplicate_lead_id)
      and greatest(reviewed.lead_id, reviewed.duplicate_lead_id)
        = greatest(pending.lead_id, pending.duplicate_lead_id)
  );

-- Collapse only unresolved inverse copies; reviewed history is preserved.
with ranked as (
  select
    id,
    row_number() over (
      partition by
        least(lead_id, duplicate_lead_id),
        greatest(lead_id, duplicate_lead_id),
        duplicate_type,
        identifier_value
      order by created_at, id
    ) as duplicate_number
  from public.lead_duplicate_flags
  where status = 'pending'
)
delete from public.lead_duplicate_flags as flag
using ranked
where flag.id = ranked.id
  and ranked.duplicate_number > 1;

update public.lead_duplicate_flags
set lead_id = least(lead_id, duplicate_lead_id),
    duplicate_lead_id = greatest(lead_id, duplicate_lead_id)
where status = 'pending'
  and lead_id > duplicate_lead_id;

-- Rebuild unresolved phone evidence from canonical phone keys. Identity fields
-- are unchanged during normalization, so suppress per-row duplicate functions
-- and rebuild the exact identifiers set-wise below.
delete from public.lead_duplicate_flags where status = 'pending' and duplicate_type = 'phone';

do $$
begin
  alter table public.leads disable trigger leads_duplicate_check;
  alter table public.leads disable trigger leads_priority_duplicate_check;
  update public.leads
  set normalized_phone = public.crm_normalize_phone(
        coalesce(phone_country_code, '') || coalesce(phone_number, '')
      )
  where normalized_phone is distinct from public.crm_normalize_phone(
    coalesce(phone_country_code, '') || coalesce(phone_number, '')
  );
  alter table public.leads enable trigger leads_duplicate_check;
  alter table public.leads enable trigger leads_priority_duplicate_check;
exception when others then
  alter table public.leads enable trigger leads_duplicate_check;
  alter table public.leads enable trigger leads_priority_duplicate_check;
  raise;
end;
$$;

update public.patients
set normalized_phone = public.crm_normalize_phone(
      coalesce(phone_country_code, '') || coalesce(phone_number, '')
    )
where normalized_phone is distinct from public.crm_normalize_phone(
  coalesce(phone_country_code, '') || coalesce(phone_number, '')
);

update public.old_database_followups
set normalized_phone = public.crm_normalize_phone(phone_number)
where normalized_phone is distinct from public.crm_normalize_phone(phone_number);

insert into public.lead_duplicate_flags (
  lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
)
select first_lead.id, second_lead.id, 'phone', first_lead.normalized_phone, 1
from public.leads as first_lead
join public.leads as second_lead
  on second_lead.id > first_lead.id
 and second_lead.normalized_phone = first_lead.normalized_phone
where first_lead.normalized_phone is not null
  and first_lead.merged_into_lead_id is null
  and second_lead.merged_into_lead_id is null
on conflict do nothing;

insert into public.lead_duplicate_flags (
  lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
)
select first_lead.id, second_lead.id, 'platform_id', first_lead.normalized_platform_id, 1
from public.leads as first_lead
join public.leads as second_lead
  on second_lead.id > first_lead.id
 and second_lead.normalized_platform_id = first_lead.normalized_platform_id
where first_lead.normalized_platform_id is not null
  and first_lead.merged_into_lead_id is null
  and second_lead.merged_into_lead_id is null
on conflict do nothing;

insert into public.lead_duplicate_flags (
  lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
)
select first_lead.id, second_lead.id, 'chat_link', first_lead.normalized_chat_link, 1
from public.leads as first_lead
join public.leads as second_lead
  on second_lead.id > first_lead.id
 and second_lead.normalized_chat_link = first_lead.normalized_chat_link
where first_lead.normalized_chat_link is not null
  and first_lead.merged_into_lead_id is null
  and second_lead.merged_into_lead_id is null
on conflict do nothing;

insert into public.lead_duplicate_flags (
  lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
)
select
  least(first_link.lead_id, second_link.lead_id),
  greatest(first_link.lead_id, second_link.lead_id),
  'platform_id',
  first_link.normalized_platform_id,
  1
from public.lead_source_links as first_link
join public.lead_source_links as second_link
  on second_link.id > first_link.id
 and second_link.lead_id <> first_link.lead_id
 and second_link.normalized_platform_id = first_link.normalized_platform_id
where first_link.normalized_platform_id is not null
on conflict do nothing;

insert into public.lead_duplicate_flags (
  lead_id, duplicate_lead_id, duplicate_type, identifier_value, confidence_score
)
select
  least(first_link.lead_id, second_link.lead_id),
  greatest(first_link.lead_id, second_link.lead_id),
  'chat_link',
  first_link.normalized_chat_link,
  1
from public.lead_source_links as first_link
join public.lead_source_links as second_link
  on second_link.id > first_link.id
 and second_link.lead_id <> first_link.lead_id
 and second_link.normalized_chat_link = first_link.normalized_chat_link
where first_link.normalized_chat_link is not null
on conflict do nothing;

revoke all on function public.crm_canonicalize_duplicate_pair() from public, anon, authenticated;
