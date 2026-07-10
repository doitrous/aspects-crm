import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Request-scoped Supabase client bound to the caller's auth cookies.
 *
 * Unlike `supabaseAdmin()` (service-role, bypasses RLS), this client acts *as
 * the signed-in user*. Use it to answer "who is calling?" — never to authorize
 * an action by trusting a value the browser sent.
 *
 * Must be called inside a Server Component / Server Action / Route Handler.
 */
export async function supabaseSession(): Promise<SupabaseClient> {
  const store = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              store.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // `middleware.ts` performs the refresh write instead, so this is safe
            // to swallow — see the Supabase SSR guidance.
          }
        },
      },
    },
  );
}

/**
 * The authenticated Supabase auth user, or `null`.
 *
 * Always `getUser()`, never `getSession()`: `getUser()` revalidates the JWT
 * against the Auth server, so a forged or stale cookie cannot impersonate
 * anyone. `getSession()` merely decodes the cookie and is not trustworthy on
 * the server.
 */
export async function getAuthUser() {
  const supabase = await supabaseSession();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}
