import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only client for the **booking platform's** Supabase project
 * (separate from the CRM project). Uses the booking service-role key so it can
 * read `appointments` and the related lookup tables past RLS. Never import this
 * into a client component.
 *
 * Configured via `BOOKING_SUPABASE_URL` + `BOOKING_SUPABASE_SERVICE_ROLE_KEY`.
 * When those are unset the booking pages degrade to an "unconfigured" state
 * instead of throwing, so the CRM still runs without the integration.
 */
let cached: SupabaseClient | null = null;

export function bookingConfigured(): boolean {
  return Boolean(
    process.env.BOOKING_SUPABASE_URL && process.env.BOOKING_SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function bookingDb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.BOOKING_SUPABASE_URL;
  const key = process.env.BOOKING_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Booking platform is not configured: set BOOKING_SUPABASE_URL and BOOKING_SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
