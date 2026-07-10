import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { Reservation } from "@/lib/types";

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits || null;
}

function splitPhone(phone: string): { cc: string | null; number: string | null } {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return { cc: null, number: null };
  if (digits.startsWith("20")) return { cc: "+20", number: digits.slice(2) };
  return { cc: null, number: digits };
}

async function nextLeadCode(db: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { data: generated, error } = await db.rpc("crm_generate_lead_id");
  if (!error && generated) return String(generated);
  const { data } = await db.from("leads").select("lead_id").order("lead_id", { ascending: false }).limit(1).maybeSingle();
  const last = data?.lead_id as string | undefined;
  const n = last && /^L\d+$/.test(last) ? Number(last.slice(1)) + 1 : 1;
  return `L${String(n).padStart(4, "0")}`;
}

async function logSystemLeadEvent(params: {
  leadUid: string;
  action: string;
  title: string;
  body?: string | null;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}) {
  const db = supabaseAdmin();
  const [audit, timeline] = await Promise.all([
    db.from("audit_logs").insert({
      actor_user_id: null,
      action: params.action,
      entity_type: "lead",
      entity_id: params.leadUid,
      old_values: params.oldValues ?? {},
      new_values: params.newValues ?? {},
      metadata: { actor_name: "System" },
    }),
    db.from("lead_timeline_events").insert({
      lead_id: params.leadUid,
      event_type: params.action,
      title: params.title,
      body: params.body ?? null,
      actor_user_id: null,
      metadata: { ...(params.newValues ?? {}), actor_name: "System" },
    }),
  ]);
  if (audit.error) throw new Error(`syncReservation(audit): ${audit.error.message}`);
  if (timeline.error) throw new Error(`syncReservation(timeline): ${timeline.error.message}`);
}

export async function syncReservationsToLeads(reservations: Reservation[]): Promise<Map<string, string>> {
  const db = supabaseAdmin();
  const result = new Map<string, string>();
  for (const reservation of reservations) {
    const now = new Date().toISOString();
    const normalizedPhone = normalizePhone(reservation.patientPhone);
    const phoneParts = splitPhone(reservation.patientPhone);
    const meta = {
      channel: "website_booking",
      booking_appointment_id: reservation.id,
      booking_status: reservation.status,
      doctor_id: reservation.doctorId ?? null,
      doctor_name: reservation.doctorName ?? null,
      branch_id: reservation.branchId ?? null,
      branch_name: reservation.branchName ?? null,
      specialty_id: reservation.specialtyId ?? null,
      specialty_name: reservation.specialtyName ?? null,
      service_id: reservation.serviceId ?? null,
      service_name: reservation.serviceName ?? null,
      appointment_date: reservation.date,
      start_time: reservation.startTime,
      primary_complaint: reservation.primaryComplaint ?? null,
      referral_source: reservation.referralSource ?? null,
      fee_at_booking: reservation.feeAtBooking ?? null,
      is_new_patient: reservation.isNewPatient,
      booked_at: reservation.createdAt,
      ingested_at: now,
    };

    const { data: byAppointment, error: byAppointmentError } = await db
      .from("leads")
      .select("id,lead_id,metadata")
      .eq("booking_appointment_id", reservation.id)
      .maybeSingle();
    if (byAppointmentError) throw new Error(`syncReservation(find appointment): ${byAppointmentError.message}`);
    if (byAppointment) {
      result.set(reservation.id, byAppointment.lead_id as string);
      continue;
    }

    if (normalizedPhone) {
      const { data: byPhone, error: byPhoneError } = await db
        .from("leads")
        .select("id,lead_id,metadata,booking_appointment_id,status")
        .eq("normalized_phone", normalizedPhone)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (byPhoneError) throw new Error(`syncReservation(find phone): ${byPhoneError.message}`);
      if (byPhone) {
        const oldValues = { booking_appointment_id: byPhone.booking_appointment_id, status: byPhone.status };
        const { error: updateError } = await db
          .from("leads")
          .update({
            booking_appointment_id: reservation.id,
            service_name: reservation.serviceName ?? undefined,
            has_unread: true,
            unread_since: now,
            last_incoming_at: now,
            metadata: { ...((byPhone.metadata as Record<string, unknown> | null) ?? {}), ...meta },
            updated_at: now,
          })
          .eq("id", byPhone.id);
        if (updateError) throw new Error(`syncReservation(link): ${updateError.message}`);
        await logSystemLeadEvent({
          leadUid: byPhone.id as string,
          action: "lead.booking_linked",
          title: "Reservation linked",
          body: `${reservation.date} ${reservation.startTime}`,
          oldValues,
          newValues: { booking_appointment_id: reservation.id, booking_status: reservation.status },
        });
        result.set(reservation.id, byPhone.lead_id as string);
        continue;
      }
    }

    const leadCode = await nextLeadCode(db);
    const newStatus = reservation.status === "confirmed" || reservation.status === "attended" ? "booked" : "new_lead";
    const { data: created, error: createError } = await db
      .from("leads")
      .insert({
        lead_id: leadCode,
        name: reservation.patientName,
        status: newStatus,
        platform: "web",
        phone_country_code: phoneParts.cc,
        phone_number: phoneParts.number,
        normalized_phone: normalizedPhone,
        service_name: reservation.serviceName ?? null,
        booking_appointment_id: reservation.id,
        source_id: process.env.CRM_BOOKING_SOURCE_ID || null,
        escalation_status: "none",
        has_unread: true,
        unread_since: now,
        unread_message_count: 1,
        last_incoming_at: now,
        first_contact_at: reservation.createdAt,
        metadata: meta,
      })
      .select("id,lead_id")
      .single();
    if (createError) throw new Error(`syncReservation(create): ${createError.message}`);
    await logSystemLeadEvent({
      leadUid: created.id as string,
      action: "lead.created_from_booking",
      title: "Lead created from reservation",
      body: `${reservation.date} ${reservation.startTime}`,
      newValues: { lead_id: created.lead_id, booking_appointment_id: reservation.id, booking_status: reservation.status },
    });
    result.set(reservation.id, created.lead_id as string);
  }
  return result;
}
