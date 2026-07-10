import "server-only";
import type { Role } from "@/lib/types";
import { assertCan, guardRoleChange, type AccountRef } from "@/lib/auth/permissions";
import { ASSIGNABLE_ROLES, dbRoleFor, guardMessage } from "@/lib/auth/roles";
import { toSessionUser, type CrmUserRow, type SessionUser } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";

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
