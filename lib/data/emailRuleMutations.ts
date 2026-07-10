import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";
import { assertCan } from "@/lib/auth/permissions";
import { logActivity } from "@/lib/audit/log";
import { parseRecipients } from "@/lib/email/rules";

/** Write side for email rules (§E). Gated on `email.manage`, fully audited. */

export class EmailRuleError extends Error {}

async function guard() {
  const actor = await writeActor();
  assertCan(actor.role, "email.manage");
  return actor;
}

export async function upsertEmailRule(input: {
  id?: string;
  name: string;
  description?: string | null;
  trigger: string;
  isActive: boolean;
  recipients: Array<{ type: string; value?: string }>;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  conditions?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  dedupeWindowHours?: number | null;
}): Promise<void> {
  const actor = await guard();
  const name = input.name.trim();
  if (!name) throw new EmailRuleError("Rule name is required.");
  if (!input.trigger.trim()) throw new EmailRuleError("A trigger is required.");
  // Validate recipient specs so a malformed payload cannot be stored.
  const recipients = parseRecipients(input.recipients);

  const db = supabaseAdmin();
  const row = {
    name,
    description: input.description ?? null,
    trigger: input.trigger.trim(),
    is_active: input.isActive,
    recipients,
    subject_template: input.subjectTemplate ?? null,
    body_template: input.bodyTemplate ?? null,
    conditions: input.conditions ?? {},
    schedule: input.schedule ?? {},
    dedupe_window_hours: input.dedupeWindowHours ?? null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data: before } = await db.from("crm_email_rules").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_email_rules").update(row).eq("id", input.id);
    if (error) throw new EmailRuleError(error.message);
    await logActivity({
      actorId: actor.id,
      action: "email_rule.updated",
      entityType: "email_rule",
      entityId: input.id,
      oldValues: (before ?? {}) as Record<string, unknown>,
      newValues: row,
    });
    return;
  }

  const { data, error } = await db
    .from("crm_email_rules")
    .insert({ ...row, created_by: actor.id })
    .select("id")
    .single();
  if (error) throw new EmailRuleError(error.message);
  await logActivity({
    actorId: actor.id,
    action: "email_rule.created",
    entityType: "email_rule",
    entityId: data.id as string,
    newValues: row,
  });
}

export async function toggleEmailRule(id: string, isActive: boolean): Promise<void> {
  const actor = await guard();
  const db = supabaseAdmin();
  const { error } = await db
    .from("crm_email_rules")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new EmailRuleError(error.message);
  await logActivity({
    actorId: actor.id,
    action: isActive ? "email_rule.enabled" : "email_rule.disabled",
    entityType: "email_rule",
    entityId: id,
    newValues: { is_active: isActive },
  });
}
