-- Keep duplicate backfill batches below hosted statement timeouts. The operation
-- remains cursor-based and idempotent; callers may safely retry the same cursor.
create or replace function public.crm_backfill_duplicate_flags_batch(
  after_lead_id uuid default null,
  batch_size integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target record;
  processed integer := 0;
  last_id uuid := after_lead_id;
  before_count bigint;
  after_count bigint;
  has_more boolean := false;
begin
  select count(*) into before_count from public.lead_duplicate_flags;
  for target in
    select id from public.leads
    where merged_into_lead_id is null
      and (after_lead_id is null or id > after_lead_id)
    order by id
    limit least(greatest(batch_size, 1), 100)
  loop
    perform public.crm_flag_duplicate_for_lead(target.id);
    perform public.crm_flag_priority_identifiers(target.id);
    processed := processed + 1;
    last_id := target.id;
  end loop;
  select count(*) into after_count from public.lead_duplicate_flags;
  select exists (
    select 1 from public.leads
    where merged_into_lead_id is null and id > last_id
  ) into has_more;
  return jsonb_build_object(
    'processed', processed,
    'created', greatest(after_count - before_count, 0),
    'next_cursor', case when has_more then last_id else null end,
    'complete', not has_more
  );
end;
$$;

revoke all on function public.crm_backfill_duplicate_flags_batch(uuid, integer) from public, anon, authenticated;
grant execute on function public.crm_backfill_duplicate_flags_batch(uuid, integer) to service_role;
