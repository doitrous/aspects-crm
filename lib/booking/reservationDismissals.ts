import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export async function dismissedWebsiteReservationIds(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin().from("crm_dismissed_website_reservations").select("appointment_id");
  // Keep reservations usable during the deployment window before migration 0025.
  if (error) return new Set();
  return new Set((data ?? []).map((row) => String(row.appointment_id)));
}
