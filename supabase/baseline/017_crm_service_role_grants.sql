-- Repair CRM privileges for server-side Supabase access.
-- Run this on the separate CRM Supabase project.

set search_path = public, extensions;


grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

grant select on all tables in schema public to authenticated;
grant usage on schema public to authenticated;

alter default privileges in schema public grant select on tables to authenticated;
