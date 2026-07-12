-- Repair the duplicate-merge function deployed by migration 0009. The CRM's
-- canonical status-history table is lead_status_history; the original function
-- body accidentally referenced the nonexistent lead_stage_history table.

set search_path = public, extensions;

do $$
declare
  merge_definition text;
begin
  select pg_get_functiondef(
    'public.crm_merge_duplicate_flag(uuid,uuid,text)'::regprocedure
  ) into merge_definition;

  if position('public.lead_stage_history' in merge_definition) > 0 then
    merge_definition := replace(
      merge_definition,
      'public.lead_stage_history',
      'public.lead_status_history'
    );
    execute merge_definition;
  end if;
end;
$$;

grant execute on function public.crm_merge_duplicate_flag(uuid, uuid, text) to service_role;
