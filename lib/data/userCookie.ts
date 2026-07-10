/**
 * Cookie naming the account an admin is *previewing the app as* (dev only).
 *
 * It is NOT the identity cookie: sign-in is a real Supabase Auth session, and
 * {@link import("./session").getSessionUser} only honours this value when the
 * verified, database-resolved role of the signed-in user is `admin` and
 * `CRM_DEV_IMPERSONATION=1`. Setting it by hand grants nothing.
 *
 * Kept in its own module (free of `next/headers`) so both the server-only
 * session helpers and the client-side `UserSwitcher` can share the name without
 * pulling server APIs into the client bundle.
 */
export const USER_COOKIE = "crm_user";
