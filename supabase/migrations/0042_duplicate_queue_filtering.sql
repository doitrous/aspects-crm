-- Search duplicate pairs across both patient records before pagination so the
-- review screen never filters only the visible page. The service-role-only RPC
-- returns filtered counts and a bounded page in one database round trip.

create or replace function public.crm_duplicate_queue_page(
  queue_view text default 'open',
  search_term text default null,
  search_field text default 'all',
  match_type_filter text default null,
  page_offset integer default 0,
  page_limit integer default 30
) returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  with filter_values as (
    select
      lower(btrim(coalesce(search_term, ''))) as needle,
      regexp_replace(coalesce(search_term, ''), '[^0-9]', '', 'g') as digit_needle,
      case when search_field in ('name', 'phone', 'mrn', 'lead_id', 'platform_id') then search_field else 'all' end as field_name,
      nullif(btrim(coalesce(match_type_filter, '')), '') as match_type_name
  ), matching as (
    select flag.*
    from public.lead_duplicate_flags as flag
    join public.leads as primary_lead on primary_lead.id = flag.lead_id
    join public.leads as duplicate_lead on duplicate_lead.id = flag.duplicate_lead_id
    cross join filter_values as filter
    where nullif(btrim(flag.identifier_value), '') is not null
      and (flag.duplicate_type <> 'phone' or length(regexp_replace(flag.identifier_value, '[^0-9]', '', 'g')) > 4)
      and (filter.match_type_name is null or flag.duplicate_type = filter.match_type_name)
      and (
        filter.needle = ''
        or case filter.field_name
          when 'name' then lower(concat_ws(' ', primary_lead.name, duplicate_lead.name)) like '%' || filter.needle || '%'
          when 'phone' then (
            lower(concat_ws(' ', primary_lead.phone_country_code, primary_lead.phone_number, primary_lead.normalized_phone,
              duplicate_lead.phone_country_code, duplicate_lead.phone_number, duplicate_lead.normalized_phone)) like '%' || filter.needle || '%'
            or (filter.digit_needle <> '' and regexp_replace(concat_ws(' ', primary_lead.phone_country_code, primary_lead.phone_number,
              primary_lead.normalized_phone, duplicate_lead.phone_country_code, duplicate_lead.phone_number,
              duplicate_lead.normalized_phone), '[^0-9]', '', 'g') like '%' || filter.digit_needle || '%')
          )
          when 'mrn' then lower(concat_ws(' ', primary_lead.mrn, duplicate_lead.mrn)) like '%' || filter.needle || '%'
          when 'lead_id' then lower(concat_ws(' ', primary_lead.lead_id, duplicate_lead.lead_id)) like '%' || filter.needle || '%'
          when 'platform_id' then lower(concat_ws(' ', primary_lead.platform_id, duplicate_lead.platform_id)) like '%' || filter.needle || '%'
          else (
            lower(concat_ws(' ', primary_lead.name, duplicate_lead.name, primary_lead.lead_id, duplicate_lead.lead_id,
              primary_lead.mrn, duplicate_lead.mrn, primary_lead.phone_country_code, primary_lead.phone_number,
              primary_lead.normalized_phone, duplicate_lead.phone_country_code, duplicate_lead.phone_number,
              duplicate_lead.normalized_phone, primary_lead.platform_id, duplicate_lead.platform_id,
              flag.identifier_value, flag.duplicate_type)) like '%' || filter.needle || '%'
            or (filter.digit_needle <> '' and regexp_replace(concat_ws(' ', primary_lead.phone_country_code,
              primary_lead.phone_number, primary_lead.normalized_phone, duplicate_lead.phone_country_code,
              duplicate_lead.phone_number, duplicate_lead.normalized_phone), '[^0-9]', '', 'g') like '%' || filter.digit_needle || '%')
          )
        end
      )
  ), selected as (
    select * from matching
    where case when queue_view = 'resolved' then status <> 'pending' else status = 'pending' end
  ), page_rows as (
    select id, lead_id, duplicate_lead_id, duplicate_type, identifier_value, status, notes,
      reviewed_by, confidence_score, match_priority, created_at
    from selected
    order by match_priority asc nulls last, created_at desc, id
    offset greatest(page_offset, 0)
    limit least(greatest(page_limit, 1), 30)
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page_rows) order by match_priority asc nulls last, created_at desc, id) from page_rows), '[]'::jsonb),
    'total', (select count(*) from selected),
    'open_total', (select count(*) from matching where status = 'pending'),
    'resolved_total', (select count(*) from matching where status <> 'pending')
  );
$$;

revoke all on function public.crm_duplicate_queue_page(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.crm_duplicate_queue_page(text, text, text, text, integer, integer) to service_role;
