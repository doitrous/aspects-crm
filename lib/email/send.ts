import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logActivity } from "@/lib/audit/log";
import { sendEmail } from "@/lib/email/resend";
import {
  parseRecipients,
  renderTemplate,
  buildDedupeKey,
  normalizeEmails,
  type RecipientSpec,
} from "@/lib/email/rules";

/**
 * DB-bound orchestration of the email-rule engine (§E).
 *
 * `dispatchRule` is the single entry point for every trigger. It:
 *   1. loads the active rule for `ruleKey` (disabled/absent → no-op);
 *   2. resolves recipient specs to real addresses from `crm_users`;
 *   3. renders subject/body from the rule templates;
 *   4. claims an idempotency slot by inserting a `queued` `crm_email_log` row
 *      keyed on a dedupe key — a unique-index collision means "already sent",
 *      so the duplicate is dropped;
 *   5. sends via Resend and records the provider's real outcome.
 */

interface DispatchContext {
  /** Stable discriminator for idempotency, e.g. an appointment id or a date. */
  discriminator: string;
  /** Template variables. */
  ctx: Record<string, string | number>;
  /** Optional CRM lead uuid to associate the log row with. */
  leadUid?: string | null;
}

async function resolveRoleEmails(dbRoles: string[]): Promise<string[]> {
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select("email")
    .in("role", dbRoles)
    .eq("is_active", true);
  return (data ?? []).map((u) => u.email as string);
}

async function resolveRecipients(specs: RecipientSpec[]): Promise<{
  emails: string[];
  unresolved: string[];
}> {
  const emails: string[] = [];
  const unresolved: string[] = [];
  for (const spec of specs) {
    switch (spec.type) {
      case "static":
        if (spec.value) emails.push(spec.value);
        break;
      case "moderators":
        emails.push(...(await resolveRoleEmails(["moderator"])));
        break;
      case "auditors":
        emails.push(...(await resolveRoleEmails(["auditor"])));
        break;
      case "role":
        if (spec.value) emails.push(...(await resolveRoleEmails([spec.value])));
        break;
      case "involved_lead":
        // The CRM stores patient phone, not email, so there is no address to
        // resolve yet. Recorded so the log explains the empty recipient set
        // instead of silently dropping it.
        unresolved.push("involved_lead (no patient email on file)");
        break;
    }
  }
  return { emails: normalizeEmails(emails), unresolved };
}

export interface DispatchOutcome {
  status: "sent" | "failed" | "skipped" | "duplicate" | "inactive";
  logId?: string;
  detail?: string;
}

export async function dispatchRule(
  ruleKey: string,
  context: DispatchContext,
): Promise<DispatchOutcome> {
  const db = supabaseAdmin();
  const { data: rule } = await db
    .from("crm_email_rules")
    .select("*")
    .eq("rule_key", ruleKey)
    .maybeSingle();

  if (!rule) return { status: "inactive", detail: "rule not found" };
  if (!rule.is_active) return { status: "inactive", detail: "rule disabled" };

  const specs = parseRecipients(rule.recipients);
  const { emails, unresolved } = await resolveRecipients(specs);
  const subject = renderTemplate((rule.subject_template as string) ?? "", context.ctx);
  const body = renderTemplate((rule.body_template as string) ?? "", context.ctx);
  const dedupeKey = buildDedupeKey(
    ruleKey,
    context.discriminator,
    rule.dedupe_window_hours as number | null,
    Date.now(),
  );

  // Claim the idempotency slot. A collision on the unique dedupe index means a
  // send already happened in this window → drop the duplicate.
  const initialStatus = emails.length === 0 ? "skipped" : "queued";
  const { data: logRow, error: insertError } = await db
    .from("crm_email_log")
    .insert({
      rule_id: rule.id as string,
      rule_key: ruleKey,
      trigger: rule.trigger as string,
      lead_id: context.leadUid ?? null,
      recipients: emails,
      subject,
      body,
      status: initialStatus,
      provider: "resend",
      dedupe_key: dedupeKey,
      error: emails.length === 0 ? `no recipients (${unresolved.join(", ") || "none configured"})` : null,
      metadata: { unresolved, discriminator: context.discriminator },
    })
    .select("id")
    .single();

  if (insertError) {
    // 23505 = unique_violation on dedupe_key → already handled.
    if ((insertError as { code?: string }).code === "23505") {
      return { status: "duplicate", detail: dedupeKey };
    }
    throw new Error(`dispatchRule(log insert): ${insertError.message}`);
  }

  const logId = logRow.id as string;
  if (emails.length === 0) {
    return { status: "skipped", logId, detail: "no recipients resolved" };
  }

  const result = await sendEmail({ to: emails, subject, text: body });
  await db
    .from("crm_email_log")
    .update({
      status: result.status,
      provider_message_id: result.providerMessageId ?? null,
      error: result.error ?? null,
      sent_at: result.status === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", logId);

  await logActivity({
    system: true,
    action: `email.${result.status}`,
    entityType: "email",
    entityId: logId,
    newValues: { rule_key: ruleKey, recipients: emails, subject, status: result.status },
    metadata: { trigger: rule.trigger, dedupe_key: dedupeKey },
  });

  return { status: result.status, logId, detail: result.error };
}
