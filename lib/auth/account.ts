/**
 * Pure mapping from a `crm_users` row to the app's {@link SessionUser}.
 *
 * Kept free of I/O and `next/headers` so the identity rules — role resolution,
 * lockout of deactivated accounts, and when an impersonation preview is allowed
 * — can be unit-tested without a database or a request context.
 */

import type { Role, User } from "@/lib/types";
import { normalizeRole } from "@/lib/auth/permissions";

/** The `crm_users` columns the session layer reads. */
export interface CrmUserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  is_active: boolean | null;
  auth_user_id: string | null;
  avatar_url?: string | null;
}

export interface SessionUser extends User {
  email: string;
  isActive: boolean;
  /** `auth.users.id` this profile is linked to. */
  authUserId: string | null;
  /** True when an admin is previewing the app as another user (dev only). */
  impersonating: boolean;
}

/** "Mona Khaled" → "MK". Falls back to the email's first letter, else "?". */
export function initialsOf(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return (email.trim()[0] ?? "?").toUpperCase();
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

/**
 * Map a row to a session user. `role` always comes from the database column —
 * never from a cookie, header, or request body.
 */
export function toSessionUser(row: CrmUserRow, impersonating = false): SessionUser {
  const email = row.email ?? "";
  const name = row.full_name?.trim() || email || "Unknown user";
  return {
    id: row.id,
    name,
    email,
    role: normalizeRole(row.role),
    initials: initialsOf(name, email),
    isActive: row.is_active ?? false,
    authUserId: row.auth_user_id,
    avatarUrl: row.avatar_url ?? undefined,
    impersonating,
  };
}

/**
 * May `role` preview the app as another account?
 *
 * Two independent gates: the feature must be switched on for the environment,
 * and the *real* (database-resolved) role must be admin. A moderator who hand-
 * writes the impersonation cookie satisfies neither.
 */
export function canImpersonate(role: Role, featureEnabled: boolean): boolean {
  return featureEnabled && role === "admin";
}
