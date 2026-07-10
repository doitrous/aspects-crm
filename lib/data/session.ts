import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@/lib/types";
import {
  canImpersonate as canImpersonateRole,
  toSessionUser,
  type CrmUserRow,
  type SessionUser,
} from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/supabase/session";
import { USER_COOKIE } from "@/lib/data/userCookie";

export { USER_COOKIE };
export type { SessionUser };

/** `crm_users` columns this module reads. */
const COLS = "id, email, full_name, role, is_active, auth_user_id";

/**
 * Dev-only impersonation switch. Off unless `CRM_DEV_IMPERSONATION=1`, and even
 * then only an admin may impersonate — see {@link getSessionUser}. Never enable
 * this in production: it exists so the auditor / moderator views can be
 * previewed without a second login.
 */
function impersonationEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.CRM_DEV_IMPERSONATION === "1"
  );
}

async function findByAuthUserId(authUserId: string): Promise<CrmUserRow | null> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select(COLS)
    .eq("auth_user_id", authUserId)
    .maybeSingle<CrmUserRow>();
  return data ?? null;
}

async function findById(id: string): Promise<CrmUserRow | null> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select(COLS)
    .eq("id", id)
    .maybeSingle<CrmUserRow>();
  return data ?? null;
}

/** Every CRM account, for the Users admin screen and the dev user switcher. */
export async function listAccounts(): Promise<SessionUser[]> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select(COLS)
    .order("full_name", { ascending: true })
    .returns<CrmUserRow[]>();
  return (data ?? []).map((r) => toSessionUser(r));
}

/**
 * Both identities for the current request.
 *
 * `real` is who actually signed in; `effective` is who the app should render as.
 * They differ only when an admin is previewing another account. Authorization
 * must never be decided from `effective` alone for destructive actions — see
 * {@link SessionContext.canImpersonate}.
 */
export interface SessionContext {
  real: SessionUser;
  effective: SessionUser;
  /** True when the *real* signed-in user may preview other accounts. */
  canImpersonate: boolean;
}

/**
 * Resolve the request's identity from the **verified** Supabase Auth session and
 * the `crm_users` profile it links to. Returns `null` when nobody is signed in,
 * when the auth user has no CRM profile, or when that profile is deactivated.
 *
 * Deactivating a user in `crm_users` therefore locks them out on their next
 * request, without needing to delete the Supabase Auth account.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const authUser = await getAuthUser();
  if (!authUser) return null;

  const row = await findByAuthUserId(authUser.id);
  if (!row) return null;

  const real = toSessionUser(row);
  if (!real.isActive) return null;

  // Impersonation is a *view* affordance, never a privilege escalation: it is
  // gated on the real, database-resolved role being admin, so a moderator who
  // hand-sets the cookie still gets their own account back.
  const canImpersonate = canImpersonateRole(real.role, impersonationEnabled());
  if (canImpersonate) {
    const wanted = (await cookies()).get(USER_COOKIE)?.value;
    if (wanted && wanted !== real.id) {
      const target = await findById(wanted);
      if (target) return { real, effective: toSessionUser(target, true), canImpersonate };
    }
  }

  return { real, effective: real, canImpersonate };
}

/** The account the app should render as, or `null` when not signed in. */
export async function getSessionUser(): Promise<SessionUser | null> {
  return (await getSessionContext())?.effective ?? null;
}

/**
 * {@link getSessionUser}, but redirects to the sign-in page instead of returning
 * `null`. Use this in every authenticated server component / server action —
 * `middleware.ts` is a fast filter, not the authorization boundary.
 */
export async function requireUser(): Promise<SessionUser> {
  return (await requireSession()).effective;
}

/** {@link getSessionContext}, redirecting to sign-in when there is no session. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login?error=no_access");
  return ctx;
}

/**
 * The active user for the CRM shell.
 *
 * Historically this read a client-settable `crm_user` cookie; it now resolves a
 * verified session. Kept under the same name so existing call sites keep working.
 */
export async function getCurrentUser(): Promise<SessionUser> {
  return requireUser();
}

/** Convenience for permission checks: `(await currentRole()) === "admin"`. */
export async function currentRole(): Promise<Role> {
  return (await requireUser()).role;
}
