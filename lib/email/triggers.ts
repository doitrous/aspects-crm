import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRule, type DispatchOutcome } from "@/lib/email/send";

/**
 * Application-event → email-rule bridges (§E). Each function maps a business
 * event to a `dispatchRule` call with a stable idempotency discriminator and
 * the template variables its rule expects. Callers should treat these as
 * best-effort: an email failure must never break the originating operation.
 */

async function leadUidFromHumanId(leadId: string): Promise<string | null> {
  if (!leadId) return null;
  const { data } = await supabaseAdmin().from("leads").select("id").eq("lead_id", leadId).maybeSingle();
  return (data?.id as string) ?? null;
}

/** Fired when a booking is created for a lead. */
export async function notifyBookingCreated(input: {
  leadId: string;
  patientName: string;
  date: string;
  startTime: string;
  serviceName?: string | null;
  appointmentId: string;
}): Promise<DispatchOutcome> {
  const leadUid = await leadUidFromHumanId(input.leadId);
  return dispatchRule("booking_created", {
    discriminator: input.appointmentId,
    leadUid,
    ctx: {
      patient_name: input.patientName,
      appointment_date: input.date,
      appointment_datetime: `${input.date} ${input.startTime}`.trim(),
      service_name: input.serviceName ?? "",
    },
  });
}
