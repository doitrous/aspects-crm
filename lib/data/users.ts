import "server-only";
import type { Role } from "@/lib/types";
import { assertCan, guardRoleChange, type AccountRef } from "@/lib/auth/permissions";
import { ASSIGNABLE_ROLES, dbRoleFor, guardMessage } from "@/lib/auth/roles";
import { toSessionUser, type CrmUserRow, type SessionUser } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";
import { logActivity } from "@/lib/audit/log";

const COLS = "id, email, full_name, role, is_active, auth_user_id";

export interface UserFilters {
  /** Matches name or email, case-insensitive. */
  q?: string;
  role?: Role | "all";
  status?: "active" | "inactive" | "all";
}

/** A user row for the admin Users table, plus its raw DB role for round-tripping. */
export interface ManagedUser extends SessionUser {
  dbRole: string | null;
}

function toManaged(row: CrmUserRow): ManagedUser {
  return { ...toSessionUser(row), dbRole: row.role };
}

/** Every CRM account, newest name-sorted, filtered in memory (the table is tiny). */
export async function listUsers(filters: UserFilters = {}): Promise<ManagedUser[]> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select(COLS)
    .order("full_name", { ascending: true })
    .returns<CrmUserRow[]>();

  let users = (data ?? []).map(toManaged);

  const q = filters.q?.trim().toLowerCase();
  if (q) {
    users = users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }
  if (filters.role && filters.role !== "all") {
    users = users.filter((u) => u.role === filters.role);
  }
  if (filters.status && filters.status !== "all") {
    const wantActive = filters.status === "active";
    users = users.filter((u) => u.isActive === wantActive);
  }
  return users;
}

export async function listUsersPage(filters: UserFilters = {}, page = 1, pageSize = 30): Promise<{ users: ManagedUser[]; total: number; page: number; pageSize: number }> {
  const safePage = Math.max(1, Math.trunc(page));
  let query = supabaseAdmin().from("crm_users").select(COLS, { count: "exact" });
  const q = filters.q?.trim().replace(/[%,()]/g, " ");
  if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
  if (filters.role && filters.role !== "all") {
    query = filters.role === "admin" ? query.in("role", ["owner_admin", "manager"]) : query.eq("role", filters.role);
  }
  if (filters.status && filters.status !== "all") query = query.eq("is_active", filters.status === "active");
  const from = (safePage - 1) * pageSize;
  const { data, count, error } = await query.order("full_name", { ascending: true }).range(from, from + pageSize - 1).returns<CrmUserRow[]>();
  if (error) throw new Error(`listUsersPage: ${error.message}`);
  return { users: (data ?? []).map(toManaged), total: count ?? 0, page: safePage, pageSize };
}

export type UserSessionEvent = { id: string; eventType: "login" | "logout"; occurredAt: string };

export async function userSessionEvents(userId: string): Promise<UserSessionEvent[]> {
  const { data, error } = await supabaseAdmin().from("crm_user_session_events").select("id,event_type,occurred_at").eq("user_id", userId).order("occurred_at", { ascending: false }).limit(30);
  if (error) {
    if (error.code === "42P01") return [];
    throw new Error(`userSessionEvents: ${error.message}`);
  }
  return (data ?? []).map((row) => ({ id: row.id as string, eventType: row.event_type as "login" | "logout", occurredAt: row.occurred_at as string }));
}

/** All accounts as {@link AccountRef}s — the input `guardRoleChange` needs. */
async function accountRefs(): Promise<AccountRef[]> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select(COLS)
    .returns<CrmUserRow[]>();
  return (data ?? []).map((r) => {
    const u = toSessionUser(r);
    return { id: u.id, role: u.role, isActive: u.isActive };
  });
}

async function findRow(id: string): Promise<CrmUserRow | null> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select(COLS)
    .eq("id", id)
    .maybeSingle<CrmUserRow>();
  return data ?? null;
}

export class UserAdminError extends Error {}

interface HistoryEntry {
  user_id: string;
  change_type: "role" | "activate" | "deactivate";
  old_role?: string | null;
  new_role?: string | null;
  old_is_active?: boolean | null;
  new_is_active?: boolean | null;
  changed_by: string;
  reason?: string | null;
}

async function recordHistory(entry: HistoryEntry): Promise<void> {
  const { error } = await supabaseAdmin().from("crm_user_role_history").insert(entry);
  if (error) throw new UserAdminError(`Could not write the audit record: ${error.message}`);
}

/**
 * Change a user's role. Server-authorized end to end: the caller's role is read
 * from the database (never the browser), the capability is checked, every
 * lockout rule in {@link guardRoleChange} is applied, and the change is written
 * to `crm_user_role_history` before the function returns.
 */
export async function changeUserRole(
  targetId: string,
  newRole: Role,
  reason?: string,
): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "users.changeRole");

  if (!ASSIGNABLE_ROLES.includes(newRole)) {
    throw new UserAdminError(`"${newRole}" is not an assignable role.`);
  }

  const row = await findRow(targetId);
  if (!row) throw new UserAdminError("That user no longer exists.");
  const target = toManaged(row);

  if (target.role === newRole) return; // nothing to do

  const verdict = guardRoleChange({
    actor: { id: actor.id, role: actor.role, isActive: actor.isActive },
    target: { id: target.id, role: target.role, isActive: target.isActive },
    newRole,
    allAccounts: await accountRefs(),
  });
  if (!verdict.ok) throw new UserAdminError(guardMessage(verdict.reason!));

  const nextDbRole = dbRoleFor(newRole, target.dbRole);
  const { error } = await supabaseAdmin()
    .from("crm_users")
    .update({ role: nextDbRole, updated_at: new Date().toISOString() })
    .eq("id", targetId);
  if (error) throw new UserAdminError(error.message);

  await recordHistory({
    user_id: targetId,
    change_type: "role",
    old_role: target.dbRole,
    new_role: nextDbRole,
    changed_by: actor.id,
    reason: reason?.trim() || null,
  });
}

/** Activate or deactivate a user, with the same guards and audit trail. */
export async function setUserActive(
  targetId: string,
  nextActive: boolean,
  reason?: string,
): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "users.activate");

  const row = await findRow(targetId);
  if (!row) throw new UserAdminError("That user no longer exists.");
  const target = toManaged(row);

  if (target.isActive === nextActive) return;

  const verdict = guardRoleChange({
    actor: { id: actor.id, role: actor.role, isActive: actor.isActive },
    target: { id: target.id, role: target.role, isActive: target.isActive },
    newActive: nextActive,
    allAccounts: await accountRefs(),
  });
  if (!verdict.ok) throw new UserAdminError(guardMessage(verdict.reason!));

  const { error } = await supabaseAdmin()
    .from("crm_users")
    .update({ is_active: nextActive, updated_at: new Date().toISOString() })
    .eq("id", targetId);
  if (error) throw new UserAdminError(error.message);

  await recordHistory({
    user_id: targetId,
    change_type: nextActive ? "activate" : "deactivate",
    old_is_active: target.isActive,
    new_is_active: nextActive,
    changed_by: actor.id,
    reason: reason?.trim() || null,
  });
}

export interface RoleHistoryEntry {
  id: string;
  changeType: string;
  oldRole: string | null;
  newRole: string | null;
  oldIsActive: boolean | null;
  newIsActive: boolean | null;
  changedByName: string;
  reason: string | null;
  createdAt: string;
}

interface HistoryRow {
  id: string;
  change_type: string;
  old_role: string | null;
  new_role: string | null;
  old_is_active: boolean | null;
  new_is_active: boolean | null;
  reason: string | null;
  created_at: string;
  changed_by: string | null;
}

/** Role/status history for one user, newest first (spec §21 "view role history"). */
export async function userRoleHistory(userId: string): Promise<RoleHistoryEntry[]> {
  const { data } = await supabaseAdmin()
    .from("crm_user_role_history")
    .select("id, change_type, old_role, new_role, old_is_active, new_is_active, reason, created_at, changed_by")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .returns<HistoryRow[]>();

  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((r) => r.changed_by).filter((v): v is string => !!v))];

  const names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await supabaseAdmin()
      .from("crm_users")
      .select("id, full_name, email")
      .in("id", actorIds)
      .returns<{ id: string; full_name: string | null; email: string | null }[]>();
    for (const a of actors ?? []) {
      names.set(a.id, a.full_name?.trim() || a.email || "Unknown");
    }
  }

  return rows.map((r) => ({
    id: r.id,
    changeType: r.change_type,
    oldRole: r.old_role,
    newRole: r.new_role,
    oldIsActive: r.old_is_active,
    newIsActive: r.new_is_active,
    changedByName: r.changed_by ? (names.get(r.changed_by) ?? "Unknown") : "System",
    reason: r.reason,
    createdAt: r.created_at,
  }));
}

/* ── Supabase Auth ↔ CRM profile sync (spec §F / §37) ─────────── */

export interface UnlinkedAuthUser {
  authUserId: string;
  email: string;
  createdAt: string | null;
  lastSignInAt: string | null;
}

/**
 * Supabase Auth users that do NOT yet have a linked `crm_users` profile.
 *
 * Read via the service-role Admin API on the server only — the service key is
 * never shipped to the browser. This is what makes newly-created Authentication
 * users visible in Users & Roles so an admin can grant them a CRM profile/role
 * (rather than silently having no access).
 */
export async function listUnlinkedAuthUsers(): Promise<UnlinkedAuthUser[]> {
  const admin = supabaseAdmin();

  // Which auth ids are already linked?
  const { data: linkedRows } = await admin.from("crm_users").select("auth_user_id");
  const linked = new Set((linkedRows ?? []).map((r) => r.auth_user_id as string).filter(Boolean));

  // Page through auth users (Admin API is paginated).
  const unlinked: UnlinkedAuthUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new UserAdminError(`Could not read Auth users: ${error.message}`);
    const users = data?.users ?? [];
    for (const u of users) {
      if (!u.email || linked.has(u.id)) continue;
      unlinked.push({
        authUserId: u.id,
        email: u.email,
        createdAt: u.created_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    if (users.length < 200) break; // last page
  }
  return unlinked;
}

/**
 * Create a CRM profile for an existing Supabase Auth user and link it, granting
 * the chosen role. Admin-only (`users.invite`); logged to the activity trail.
 */
export async function linkAuthUser(input: {
  authUserId: string;
  email: string;
  fullName?: string;
  role: Role;
}): Promise<string> {
  const actor = await writeActor();
  assertCan(actor.role, "users.invite");
  if (!ASSIGNABLE_ROLES.includes(input.role)) {
    throw new UserAdminError(`"${input.role}" is not an assignable role.`);
  }
  const admin = supabaseAdmin();

  // Refuse if this auth id is already linked (idempotency / no duplicates).
  const { data: existing } = await admin
    .from("crm_users")
    .select("id")
    .eq("auth_user_id", input.authUserId)
    .maybeSingle();
  if (existing) throw new UserAdminError("This Auth user already has a CRM profile.");

  const dbRole = dbRoleFor(input.role, null);
  const { data, error } = await admin
    .from("crm_users")
    .insert({
      auth_user_id: input.authUserId,
      email: input.email,
      full_name: input.fullName?.trim() || input.email.split("@")[0],
      role: dbRole,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw new UserAdminError(error.message);

  await logActivity({
    actorId: actor.id,
    action: "user.profile_linked",
    entityType: "crm_user",
    entityId: data.id as string,
    newValues: { auth_user_id: input.authUserId, email: input.email, role: dbRole },
  });
  return data.id as string;
}
