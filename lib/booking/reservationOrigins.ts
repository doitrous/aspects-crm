import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Appointment ids created by staff inside the CRM. They remain on calendars
 * and lead histories, but never belong in the public website-reservation queue. */
export async function crmCreatedAppointmentIds(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin()
    .from("crm_lead_booking_links")
    .select("appointment_id")
    .eq("source", "crm");
  if (error) throw new Error(`crmCreatedAppointmentIds: ${error.message}`);
  return new Set((data ?? []).map((row) => String(row.appointment_id)));
}
