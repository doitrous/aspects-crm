"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseSession } from "@/lib/supabase/session";
import { USER_COOKIE } from "@/lib/data/userCookie";
import { supabaseAdmin } from "@/lib/supabase/server";

async function recordSessionEvent(authUserId: string, eventType: "login" | "logout"): Promise<void> {
  const db = supabaseAdmin();
  const { data: profile } = await db.from("crm_users").select("id").eq("auth_user_id", authUserId).maybeSingle();
  const { error } = await db.from("crm_user_session_events").insert({
    user_id: profile?.id ?? null,
    auth_user_id: authUserId,
    event_type: eventType,
    metadata: { source: "crm_web" },
  });
  if (error && error.code !== "42P01") console.error("Could not record CRM session event", error.message);
}

/** Shape returned to the login form via `useActionState`. */
export interface SignInState {
  error: string | null;
}

/** Only allow same-origin, absolute-path redirects — never `//evil.com`. */
function safeNext(next: FormDataEntryValue | null): string {
  const value = typeof next === "string" ? next : "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return "/calendar";
}

/**
 * Sign in with email + password against Supabase Auth. On success the SSR client
 * writes the session cookies, and `requireUser()` will resolve the caller's
 * `crm_users` profile on the next request.
 *
 * The generic failure message is deliberate: distinguishing "no such user" from
 * "wrong password" lets an attacker enumerate staff email addresses.
 */
export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await supabaseSession();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Incorrect email or password." };
  }

  // A fresh login never inherits a previous admin's impersonation preview.
  (await cookies()).delete(USER_COOKIE);
  if (data.user) await recordSessionEvent(data.user.id, "login");

  redirect(safeNext(formData.get("next")));
}

/** Sign out and return to the login screen. */
export async function signOut(): Promise<void> {
  const supabase = await supabaseSession();
  const { data } = await supabase.auth.getUser();
  if (data.user) await recordSessionEvent(data.user.id, "logout");
  await supabase.auth.signOut();
  (await cookies()).delete(USER_COOKIE);
  redirect("/login");
}
