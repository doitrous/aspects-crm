import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchTrigger, type DispatchOutcome } from "@/lib/email/send";

/**
 * Application-event → email-rule bridges (§E). Each function maps a business
 * event to a `dispatchRule` call with a stable idempotency discriminator and
 * the template variables its rule expects. Callers should treat these as
 * best-effort: an email failure must never break the originating operation.
 */

async function leadUidFromHumanId(leadId: string): Promise<string | null> {
  if (!leadId) return null;
  const { data } = await supabaseAdmin().from("leads").select("id").eq("lead_id", leadId).is("deleted_at", null).maybeSingle();
  return (data?.id as string) ?? null;
}

/** Fired when a booking is created for a lead. */
export async function notifyBookingCreated(input: {
  leadId: string;
  patientName: string;
  date: string;
  startTime: string;
  serviceName?: string | null;
  patientEmail?: string | null;
  appointmentId: string;
}): Promise<DispatchOutcome[]> {
  const leadUid = await leadUidFromHumanId(input.leadId);
  return dispatchTrigger("booking_created", {
    discriminator: input.appointmentId,
    leadUid,
    ctx: {
      patient_name: input.patientName,
      appointment_date: input.date,
      appointment_datetime: `${input.date} ${input.startTime}`.trim(),
      service_name: input.serviceName ?? "",
      patient_email: input.patientEmail ?? "",
    },
  });
}

export async function notifyLeadStatusChanged(input: {
  leadUid: string;
  leadId: string;
  patientName: string;
  fromStatus: string;
  toStatus: string;
}): Promise<DispatchOutcome[]> {
  return dispatchTrigger("lead_status_changed", {
    discriminator: `${input.leadUid}:${input.toStatus}`,
    leadUid: input.leadUid,
    ctx: {
      lead_id: input.leadId,
      patient_name: input.patientName,
      from_status: input.fromStatus,
      to_status: input.toStatus,
    },
  });
}

export async function notifyBookingStatusChanged(input: {
  leadUid?: string | null;
  leadId?: string | null;
  patientName?: string | null;
  appointmentId: string;
  fromStatus: string;
  toStatus: string;
}): Promise<DispatchOutcome[]> {
  return dispatchTrigger("booking_status_changed", {
    discriminator: `${input.appointmentId}:${input.toStatus}`,
    leadUid: input.leadUid,
    ctx: {
      lead_id: input.leadId ?? "",
      patient_name: input.patientName ?? "Patient",
      appointment_id: input.appointmentId,
      from_status: input.fromStatus,
      to_status: input.toStatus,
    },
  });
}
