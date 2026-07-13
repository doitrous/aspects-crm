-- Values such as "1" are placeholders, not patient identities. Prevent the
-- duplicate trigger (and any other insert path) from creating phone flags
-- unless the normalized identifier contains at least five digits.

set search_path = public, extensions;

create or replace function public.crm_ignore_short_phone_duplicate()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.duplicate_type = 'phone'
     and char_length(regexp_replace(coalesce(new.identifier_value, ''), '\D', '', 'g')) <= 4 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists lead_duplicate_flags_ignore_short_phone on public.lead_duplicate_flags;
create trigger lead_duplicate_flags_ignore_short_phone
before insert on public.lead_duplicate_flags
for each row execute function public.crm_ignore_short_phone_duplicate();

-- Remove only unresolved false positives; reviewed history remains intact.
delete from public.lead_duplicate_flags
where duplicate_type = 'phone'
  and status = 'pending'
  and char_length(regexp_replace(coalesce(identifier_value, ''), '\D', '', 'g')) <= 4;

revoke all on function public.crm_ignore_short_phone_duplicate() from public, anon, authenticated;
