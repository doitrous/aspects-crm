import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";
import { assertCan } from "@/lib/auth/permissions";
import { sendEmail } from "@/lib/email/resend";
import { logActivity } from "@/lib/audit/log";

/** One row of the Emails log page (§D). */
export interface EmailLogRow {
  id: string;
  createdAt: string;
  sentAt: string | null;
  ruleKey: string | null;
  trigger: string | null;
  recipients: string[];
  subject: string | null;
  status: string;
  provider: string | null;
  providerMessageId: string | null;
  error: string | null;
  leadHumanId: string | null;
}

export class ManualEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualEmailError";
  }
}

export async function listEmailLog(limit = 200): Promise<EmailLogRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("crm_email_log")
    .select(
      "id,created_at,sent_at,rule_key,trigger,recipients,subject,status,provider,provider_message_id,error,lead_id,leads(lead_id)",
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 500));
  if (error) throw new Error(`listEmailLog: ${error.message}`);
  return (data ?? []).map((r) => {
    const leadJoin = r.leads as { lead_id?: string } | { lead_id?: string }[] | null;
    const leadHumanId = Array.isArray(leadJoin) ? leadJoin[0]?.lead_id : leadJoin?.lead_id;
    return {
      id: r.id as string,
      createdAt: r.created_at as string,
      sentAt: (r.sent_at as string) ?? null,
      ruleKey: (r.rule_key as string) ?? null,
      trigger: (r.trigger as string) ?? null,
      recipients: (r.recipients as string[]) ?? [],
      subject: (r.subject as string) ?? null,
      status: (r.status as string) ?? "queued",
      provider: (r.provider as string) ?? null,
      providerMessageId: (r.provider_message_id as string) ?? null,
      error: (r.error as string) ?? null,
      leadHumanId: leadHumanId ?? null,
    };
  });
}

export async function sendManualEmail(input: { recipients: string[]; subject: string; body: string }): Promise<string> {
  const actor = await writeActor();
  assertCan(actor.role, "email.manage");
  const recipients = [...new Set(input.recipients.map((v) => v.trim().toLowerCase()).filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))];
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!recipients.length) throw new ManualEmailError("Enter at least one valid recipient email.");
  if (!subject) throw new ManualEmailError("Subject is required.");
  if (!body) throw new ManualEmailError("Message body is required.");

  const result = await sendEmail({ to: recipients, subject, text: body });
  const db = supabaseAdmin();
  const { data, error } = await db.from("crm_email_log").insert({
    rule_key: "manual",
    trigger: "manual_send",
    recipients,
    subject,
    body,
    status: result.status,
    provider: "resend",
    provider_message_id: result.providerMessageId ?? null,
    error: result.error ?? null,
    sent_at: result.status === "sent" ? new Date().toISOString() : null,
    metadata: { actor_role: actor.role },
  }).select("id").single();
  if (error) throw new Error(`Could not record email result: ${error.message}`);
  await logActivity({ actorId: actor.id, action: "email.manual_sent", entityType: "email", entityId: data.id as string, newValues: { recipients, subject, status: result.status } });
  if (result.status !== "sent") throw new ManualEmailError(result.error ?? "Email was not sent.");
  return "Email sent and recorded.";
}
