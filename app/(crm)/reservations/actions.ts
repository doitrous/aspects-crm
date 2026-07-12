"use server";

import { revalidatePath } from "next/cache";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { ActorError, writeActor } from "@/lib/data/actor";
import { logActivity } from "@/lib/audit/log";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface ReservationManagementState { ok: boolean; message?: string; error?: string }
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refreshReservationPages() {
  for (const path of ["/reservations", "/calendar", "/database", "/booked"]) revalidatePath(path);
}

function expectedError(error: unknown): ReservationManagementState {
  if (error instanceof PermissionError) return { ok: false, error: "Only an admin or auditor may dismiss or delete website reservations." };
  if (error instanceof ActorError) return { ok: false, error: error.message };
  const message = (error as Error).message ?? "";
  if (message.includes("crm_dismissed_website_reservations")) return { ok: false, error: "Apply database migration 0025 before dismissing reservations." };
  console.error("website reservation management failed", error);
  return { ok: false, error: "The reservation action could not be completed." };
}

function validateWarnings(formData: FormData): string | null {
  if (String(formData.get("warningOne")) !== "acknowledged" || String(formData.get("warningTwo")) !== "acknowledged") {
    return "Both confirmation warnings must be acknowledged.";
  }
  return null;
}

export async function dismissWebsiteReservationAction(_previous: ReservationManagementState, formData: FormData): Promise<ReservationManagementState> {
  try {
    const actor = await writeActor();
    assertCan(actor.role, "reservations.manage");
    const appointmentId = String(formData.get("appointmentId") ?? "").trim();
    if (!ID_PATTERN.test(appointmentId)) return { ok: false, error: "Invalid reservation ID." };
    const warningError = validateWarnings(formData);
    if (warningError) return { ok: false, error: warningError };
    const { error } = await supabaseAdmin().from("crm_dismissed_website_reservations").upsert({ appointment_id: appointmentId, dismissed_by: actor.id, dismissed_at: new Date().toISOString() });
    if (error) throw error;
    await logActivity({ actorId: actor.id, action: "reservation.dismissed", entityType: "website_reservation", entityId: appointmentId, newValues: { dismissed: true }, metadata: { warning_count: 2, actor_name: actor.name, actor_role: actor.role } });
    refreshReservationPages();
    return { ok: true, message: "Reservation dismissed from the website queue." };
  } catch (error) {
    return expectedError(error);
  }
}

export async function deleteWebsiteReservationAction(_previous: ReservationManagementState, formData: FormData): Promise<ReservationManagementState> {
  try {
    const actor = await writeActor();
    assertCan(actor.role, "reservations.manage");
    const appointmentId = String(formData.get("appointmentId") ?? "").trim();
    if (!ID_PATTERN.test(appointmentId)) return { ok: false, error: "Invalid reservation ID." };
    const warningError = validateWarnings(formData);
    if (warningError) return { ok: false, error: warningError };
    if (String(formData.get("confirmation") ?? "").trim() !== "DELETE RESERVATION") return { ok: false, error: "Type DELETE RESERVATION exactly to continue." };
    if (!bookingConfigured()) return { ok: false, error: "Booking platform is not configured." };

    const booking = bookingDb();
    const { data: appointment, error: readError } = await booking.from("appointments").select("id,patient_name,patient_phone,appointment_date,start_time,status").eq("id", appointmentId).maybeSingle();
    if (readError) throw readError;
    if (!appointment) return { ok: false, error: "Reservation not found. It may already have been deleted." };
    const { error: deleteError } = await booking.from("appointments").delete().eq("id", appointmentId);
    if (deleteError) throw new Error(`Booking platform refused deletion: ${deleteError.message}`);

    const crm = supabaseAdmin();
    const { data: linkedLead } = await crm.from("crm_lead_booking_links").select("lead_id").eq("appointment_id", appointmentId).maybeSingle();
    await crm.from("crm_lead_booking_links").delete().eq("appointment_id", appointmentId);
    await crm.from("crm_dismissed_website_reservations").delete().eq("appointment_id", appointmentId);
    if (linkedLead?.lead_id) await crm.from("leads").update({ booking_appointment_id: null, updated_at: new Date().toISOString() }).eq("id", linkedLead.lead_id).eq("booking_appointment_id", appointmentId);
    await logActivity({ actorId: actor.id, action: "reservation.deleted", entityType: "website_reservation", entityId: appointmentId, oldValues: appointment as Record<string, unknown>, newValues: { deleted: true }, metadata: { warning_count: 2, actor_name: actor.name, actor_role: actor.role, linked_lead_id: linkedLead?.lead_id ?? null } });
    refreshReservationPages();
    return { ok: true, message: "Website reservation permanently deleted. The patient lead was retained in Database." };
  } catch (error) {
    return expectedError(error);
  }
}
