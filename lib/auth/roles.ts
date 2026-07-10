/**
 * Pure role-assignment rules for the admin Users screen.
 *
 * Split out of `lib/data/users.ts` (which is `server-only`) so the mapping
 * between the app's {@link Role} and the live `crm_role` enum can be tested
 * without a database.
 */

import type { Role } from "@/lib/types";
import type { GuardResult } from "@/lib/auth/permissions";

/** The roles an administrator may assign from the Users screen (spec §21). */
export const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "auditor", "moderator"] as const;

export function isAssignableRole(value: string): value is Role {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

/**
 * Map an app {@link Role} onto a value of the live `crm_role` enum
 * (`owner_admin | manager | moderator | doctor | auditor | viewer`).
 *
 * There is no `admin` member, and two members normalize back to `admin`:
 * `owner_admin` and `manager`. Granting admin therefore writes **`manager`** —
 * the app never mints a new `owner_admin`, so the clinic owner's account stays
 * distinguishable from staff who merely hold admin rights.
 *
 * Re-granting admin to someone who is already `owner_admin` keeps `owner_admin`,
 * so a no-op edit can never silently demote the owner.
 */
export function dbRoleFor(next: Role, currentDbRole: string | null): string {
  if (next === "admin") return currentDbRole === "owner_admin" ? "owner_admin" : "manager";
  return next; // auditor | moderator | viewer all exist verbatim in the enum
}

/** Human text for a {@link GuardResult} rejection. */
export function guardMessage(reason: NonNullable<GuardResult["reason"]>): string {
  switch (reason) {
    case "not_permitted":
      return "You do not have permission to change user access.";
    case "moderator_self_role_change":
      return "You cannot change your own role.";
    case "self_deactivate":
      return "You cannot deactivate your own account.";
    case "last_active_admin":
      return "This is the last active admin. Promote another admin first.";
  }
}
