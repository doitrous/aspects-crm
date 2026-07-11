import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRule } from "@/lib/email/send";

/**
 * Booking → CRM ingest receiver.
 *
 * The public booking site (directly, or via an n8n workflow) POSTs every new
 * patient reservation here. The reservation is turned into / linked to a CRM
 * lead so it surfaces under "New Leads" as **unread**, in addition to appearing
 * live under "Website Reservations" (which reads the booking DB directly).
 *
 * Auth: shared secret in `CRM_INGEST_API_KEY`, sent as either
 *   Authorization: Bearer <key>   or   x-api-key: <key>
 *
 * This endpoint is the *receiver* only; the booking-side push (or n8n) is wired
 * in Phase 5. It writes to the CRM's own Supabase via the service role, so it is
 * independent of `CRM_DATA_SOURCE` (always live).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Minimal payload the booking platform sends for a reservation. */
interface ReservationPayload {
  bookingAppointmentId: string;
  patientName: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  patientEmail?: string;
  gender?: "male" | "female" | null;
  serviceName?: string;
  doctorName?: string;
  branchName?: string;
  specialtyName?: string;
  appointmentDate?: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  isNewPatient?: boolean;
  primaryComplaint?: string;
  referralSource?: string;
  feeAtBooking?: number;
  createdAt?: string; // ISO, when the reservation was booked
}

const LEADS = "leads";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function presentedKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-api-key");
  return x ? x.trim() : null;
}

/** Same normalization the CRM uses elsewhere: digits of country code + number. */
function normalizePhone(cc?: string, num?: string): string | null {
  const digits = `${cc ?? ""}${num ?? ""}`.replace(/\D/g, "");
  return digits.length ? digits : null;
}

/** Next sequential lead code, e.g. "L0110" → "L0111". Defensive fallback in case
 *  the table has no DB-side default; harmless if it does. */
async function nextLeadCode(db: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { data } = await db
    .from(LEADS)
    .select("lead_id")
    .order("lead_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data?.lead_id as string | undefined;
  const n = last && /^L\d+$/.test(last) ? Number(last.slice(1)) + 1 : 1;
  return `L${String(n).padStart(4, "0")}`;
}

export async function POST(req: Request) {
  const expected = process.env.CRM_INGEST_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "ingest_not_configured" },
      { status: 503 },
    );
  }
  if (presentedKey(req) !== expected) return unauthorized();

  let body: ReservationPayload;
  try {
    body = (await req.json()) as ReservationPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (!body.bookingAppointmentId || !body.patientName) {
    return NextResponse.json(
      { ok: false, error: "missing_required_fields", need: ["bookingAppointmentId", "patientName"] },
      { status: 422 },
    );
  }

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const normalizedPhone = normalizePhone(body.phoneCountryCode, body.phoneNumber);

  const channelMeta = {
    channel: "website_booking",
    booking_appointment_id: body.bookingAppointmentId,
    doctor_name: body.doctorName ?? null,
    branch_name: body.branchName ?? null,
    specialty_name: body.specialtyName ?? null,
    appointment_date: body.appointmentDate ?? null,
    start_time: body.startTime ?? null,
    primary_complaint: body.primaryComplaint ?? null,
    referral_source: body.referralSource ?? null,
    fee_at_booking: body.feeAtBooking ?? null,
    is_new_patient: body.isNewPatient ?? null,
    booked_at: body.createdAt ?? now,
    ingested_at: now,
  };

  // 1) Already ingested this exact reservation? Touch its unread state.
  const { data: byAppt } = await db
    .from(LEADS)
    .select("id, lead_id, metadata")
    .eq("booking_appointment_id", body.bookingAppointmentId)
    .maybeSingle();

  if (byAppt) {
    const { error: linkError } = await db.from("crm_lead_booking_links").upsert({
      lead_id: byAppt.id,
      appointment_id: body.bookingAppointmentId,
      source: "website_ingest",
    }, { onConflict: "appointment_id" });
    if (linkError) return NextResponse.json({ ok: false, error: "booking_link_failed" }, { status: 500 });
    await db
      .from(LEADS)
      .update({
        has_unread: true,
        unread_since: now,
        last_incoming_at: now,
        metadata: { ...(byAppt.metadata ?? {}), ...channelMeta },
        updated_at: now,
      })
      .eq("id", byAppt.id);
    return NextResponse.json({ ok: true, action: "updated", leadId: byAppt.id, leadCode: byAppt.lead_id });
  }

  // 2) Same patient by phone? Link the reservation to the existing lead + mark unread.
  if (normalizedPhone) {
    const { data: byPhone } = await db
      .from(LEADS)
      .select("id, lead_id, metadata")
      .eq("normalized_phone", normalizedPhone)
      .is("merged_into_lead_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byPhone) {
      await db
        .from(LEADS)
        .update({
          booking_appointment_id: body.bookingAppointmentId,
          service_name: body.serviceName ?? undefined,
          has_unread: true,
          unread_since: now,
          last_incoming_at: now,
          metadata: { ...(byPhone.metadata ?? {}), ...channelMeta },
          updated_at: now,
        })
        .eq("id", byPhone.id);
      const { error: linkError } = await db.from("crm_lead_booking_links").upsert({
        lead_id: byPhone.id,
        appointment_id: body.bookingAppointmentId,
        source: "website_ingest",
      }, { onConflict: "appointment_id" });
      if (linkError) return NextResponse.json({ ok: false, error: "booking_link_failed" }, { status: 500 });
      return NextResponse.json({ ok: true, action: "linked", leadId: byPhone.id, leadCode: byPhone.lead_id });
    }
  }

  // 3) Brand-new lead from the reservation.
  const leadCode = await nextLeadCode(db);
  const insert = {
    lead_id: leadCode,
    name: body.patientName,
    status: "new_lead",
    platform: "manual", // no distinct `website_booking` platform value yet; channel is in metadata
    gender: body.gender ?? null,
    phone_country_code: body.phoneCountryCode ?? null,
    phone_number: body.phoneNumber ?? null,
    normalized_phone: normalizedPhone,
    service_name: body.serviceName ?? null,
    booking_appointment_id: body.bookingAppointmentId,
    source_id: process.env.CRM_BOOKING_SOURCE_ID || null,
    escalation_status: "none",
    has_unread: true,
    unread_since: now,
    unread_message_count: 1,
    last_incoming_at: now,
    first_contact_at: body.createdAt ?? now,
    metadata: channelMeta,
    created_at: now,
    updated_at: now,
  };

  const { data: created, error } = await db
    .from(LEADS)
    .insert(insert)
    .select("id, lead_id")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: "insert_failed", detail: error.message },
      { status: 500 },
    );
  }
  const { error: linkError } = await db.from("crm_lead_booking_links").upsert({
    lead_id: created.id,
    appointment_id: body.bookingAppointmentId,
    source: "website_ingest",
  }, { onConflict: "appointment_id" });
  if (linkError) return NextResponse.json({ ok: false, error: "booking_link_failed" }, { status: 500 });

  // Best-effort booking-created notification for the new public reservation.
  // Idempotent on the appointment id, so a re-POST does not re-notify. An email
  // failure must never fail ingest.
  try {
    await dispatchRule("booking_created", {
      discriminator: body.bookingAppointmentId,
      leadUid: created.id as string,
      ctx: {
        patient_name: body.patientName,
        appointment_date: body.appointmentDate ?? "",
        appointment_datetime: `${body.appointmentDate ?? ""} ${body.startTime ?? ""}`.trim(),
        service_name: body.serviceName ?? "",
      },
    });
  } catch (emailErr) {
    console.error("ingest booking_created email dispatch failed", emailErr);
  }

  return NextResponse.json({ ok: true, action: "created", leadId: created.id, leadCode: created.lead_id });
}
