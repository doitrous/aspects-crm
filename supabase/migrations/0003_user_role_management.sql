-- ============================================================================
-- 0003_user_role_management.sql
--
-- Users & Role Management (spec §21). Additive and idempotent.
--
-- HOW TO APPLY: CRM Supabase project → SQL Editor → paste → Run.
--
-- Reconciliation notes vs the live schema:
--  * The CRM ALREADY has the "profiles" table the spec asks for: `crm_users`
--    (columns: id, auth_user_id, email, full_name, role, is_active, doctor_id,
--    booking_admin_profile_id, created_at, updated_at). We do NOT create a
--    duplicate `profiles` table (global rule: don't duplicate tables).
--  * The only genuinely-new object is the role/status change history table
--    below, which powers the user detail drawer's "Audit History" tab and the
--    role-change confirmation audit trail.
--  * User creation/invitation happens server-side via Supabase Auth; this file
--    stores NO passwords.
--
-- RLS enabled, no permissive policy → server-only (service role) access, matching
-- every other CRM table until real auth + per-role policies land.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'crm_user_change_type') then
    create type crm_user_change_type as enum ('role','activate','deactivate','invite','create');
  end if;
end $$;

create table if not exists crm_user_role_history (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references crm_users(id) on delete cascade,
  change_type   crm_user_change_type not null,
  old_role      text,
  new_role      text,
  old_is_active boolean,
  new_is_active boolean,
  changed_by    uuid references crm_users(id) on delete set null,
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists crm_user_role_history_by_user on crm_user_role_history (user_id, created_at desc);
create index if not exists crm_user_role_history_by_actor on crm_user_role_history (changed_by);

alter table crm_user_role_history enable row level security;
