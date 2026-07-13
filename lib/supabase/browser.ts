"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client, bound to the anon key and the auth cookies written
 * by {@link import("./session")}. Only ever holds the *user's* session — never
 * the service-role key, which stays server-side in `lib/supabase/server.ts`.
 */
let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase Auth is not configured for this application.");
  cached = createBrowserClient(url, anonKey);
  return cached;
}
