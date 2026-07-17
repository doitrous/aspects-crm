"use server";

import { revalidatePath } from "next/cache";
import { PermissionError, assertCan } from "@/lib/auth/permissions";
import { ActorError, writeActor } from "@/lib/data/actor";
import { supabaseAdmin } from "@/lib/supabase/server";
import { logActivity } from "@/lib/audit/log";
import {
  SettingsError,
  upsertTag,
  upsertLostReason,
  upsertEscalationReason,
  updateSlaRule,
  upsertFollowUpStage,
  deleteFollowUpStage,
  updateAuditorTargets,
  updateAiPrompt,
} from "@/lib/data/settingsMutations";
import {
  EmailRuleError,
  upsertEmailRule,
  toggleEmailRule,
} from "@/lib/data/emailRuleMutations";

export interface SettingsActionState {
  ok: boolean;
  error?: string;
  message?: string;
  cursor?: string | null;
  complete?: boolean;
  processedLeads?: string[];
  processed?: number;
  created?: number;
  remaining?: number;
  batchNumber?: number;
  runId?: string;
  retryable?: boolean;
}

export async function backfillDuplicatesAction(_prev: SettingsActionState, formData: FormData): Promise<SettingsActionState> {
  const cursor = String(formData.get("cursor") ?? "").trim() || null;
  const batchNumber = Math.max(1, Number.parseInt(String(formData.get("batchNumber") ?? "1"), 10) || 1);
  const runId = String(formData.get("runId") ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || crypto.randomUUID();
  try {
    const actor = await writeActor();
    assertCan(actor.role, "settings.manage");
    const db = supabaseAdmin();
    let candidatesQuery = db.from("leads").select("id,lead_id", { count: "exact" }).is("merged_into_lead_id", null).order("id").limit(50);
    if (cursor) candidatesQuery = candidatesQuery.gt("id", cursor);
    const candidates = await candidatesQuery;
    if (candidates.error) throw new SettingsError(candidates.error.message);
    const { data, error } = await db.rpc("crm_backfill_duplicate_flags_batch", { after_lead_id: cursor, batch_size: 50 });
    if (error) {
      if (error.code === "57014" || error.message.toLowerCase().includes("statement timeout")) {
        return { ok: false, error: "This duplicate-check batch exceeded the database time limit. No patients were merged. It will be retried from the same cursor.", cursor, batchNumber, runId, remaining: candidates.count ?? undefined, retryable: true };
      }
      throw new SettingsError(error.message);
    }
    const result = data as { processed?: number; created?: number; next_cursor?: string | null; complete?: boolean };
    if (!result.complete && !result.next_cursor) throw new SettingsError("The database returned an incomplete batch without a continuation cursor. The automatic run was stopped safely.");
    const processedLeads = (candidates.data ?? []).slice(0, result.processed ?? 0).map((lead) => String(lead.lead_id || lead.id));
    const remaining = Math.max(0, (candidates.count ?? result.processed ?? 0) - (result.processed ?? 0));
    await logActivity({ actorId: actor.id, action: "duplicates.backfill_batch_run", entityType: "duplicate_backfill", entityId: result.next_cursor ?? cursor ?? "complete", newValues: { ...result, run_id: runId, batch_number: batchNumber, remaining, processed_lead_numbers: processedLeads } });
    revalidatePath("/duplicates");
    revalidatePath("/activity");
    revalidatePath("/audit-logs");
    return { ok: true, cursor: result.complete ? null : result.next_cursor ?? null, complete: Boolean(result.complete), processedLeads, processed: result.processed ?? 0, created: result.created ?? 0, remaining, batchNumber, runId, message: result.complete ? `Duplicate backfill is complete. Final batch checked ${processedLeads.length} lead${processedLeads.length === 1 ? "" : "s"}.` : `Batch ${batchNumber} checked ${result.processed ?? 0} records and created ${result.created ?? 0} new review flags. Continuing automatically.` };
  } catch (err) {
    return { ...fail(err), cursor, batchNumber, runId };
  }
}

/** Map settings errors to form state so production RSC does not become a digest page. */
function fail(err: unknown): SettingsActionState {
  if (
    err instanceof SettingsError ||
    err instanceof EmailRuleError ||
    err instanceof ActorError
  ) {
    return { ok: false, error: err.message };
  }
  if (err instanceof PermissionError) {
    return { ok: false, error: "You are not authorized to change this setting." };
  }
  console.error("settings mutation failed", err);
  return { ok: false, error: "The setting could not be saved. Please try again." };
}

function done(message: string): SettingsActionState {
  revalidatePath("/settings");
  revalidatePath("/leads");
  revalidatePath("/auditor");
  return { ok: true, message };
}

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function bool(fd: FormData, k: string): boolean {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}
function int(fd: FormData, k: string, fallback = 0): number {
  const n = Number(fd.get(k));
  return Number.isFinite(n) ? n : fallback;
}

export async function upsertTagAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await upsertTag({
      id: str(fd, "id") || undefined,
      name: str(fd, "name"),
      color: str(fd, "color") || null,
      displayOrder: int(fd, "displayOrder"),
      isActive: bool(fd, "isActive"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Tag saved.");
}

export async function upsertLostReasonAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await upsertLostReason({
      id: str(fd, "id") || undefined,
      label: str(fd, "label"),
      isActive: bool(fd, "isActive"),
      displayOrder: int(fd, "displayOrder"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Lost reason saved.");
}

export async function upsertEscalationReasonAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await upsertEscalationReason({
      id: str(fd, "id") || undefined,
      label: str(fd, "label"),
      severity: (str(fd, "severity") as "low" | "medium" | "high" | "critical") || "medium",
      isActive: bool(fd, "isActive"),
      displayOrder: int(fd, "displayOrder"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Escalation reason saved.");
}

export async function updateSlaRuleAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await updateSlaRule({
      id: str(fd, "id"),
      replyDeadlineMinutes: int(fd, "replyDeadlineMinutes", 30),
      warningThresholdMinutes: int(fd, "warningThresholdMinutes", 20),
      isActive: bool(fd, "isActive"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("SLA rule saved.");
}

export async function upsertFollowUpStageAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await upsertFollowUpStage({
      id: str(fd, "id") || undefined,
      workflowType: (str(fd, "workflowType") as "regular" | "postop") || "regular",
      name: str(fd, "name"),
      stageOrder: int(fd, "stageOrder"),
      dueAfterAmount: int(fd, "dueAfterAmount"),
      dueAfterUnit: (str(fd, "dueAfterUnit") as "hours" | "days" | "weeks") || "days",
      anchor: str(fd, "anchor") || "stage_entry",
      applicableStatus: str(fd, "applicableStatus") || null,
      applicableTagId: str(fd, "applicableTagId") || null,
      moderatorInstruction: str(fd, "moderatorInstruction") || null,
      isActive: bool(fd, "isActive"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Follow-up step saved.");
}

export async function deleteFollowUpStageAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await deleteFollowUpStage(str(fd, "id"));
  } catch (err) {
    return fail(err);
  }
  return done("Follow-up step removed.");
}

export async function updateAuditorTargetsAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await updateAuditorTargets({
      targetCplEgp: int(fd, "targetCplEgp"),
      responseTimeThresholdMinutes: int(fd, "responseTimeThresholdMinutes", 30),
      followupCompletionTarget: int(fd, "followupCompletionTarget", 85),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Targets saved.");
}

export async function updateAiPromptAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await updateAiPrompt({
      id: str(fd, "id") || undefined,
      promptKey: str(fd, "promptKey") || "crm_reply_assistant",
      title: str(fd, "title"),
      systemPrompt: str(fd, "systemPrompt"),
      replyRules: str(fd, "replyRules") || null,
    });
  } catch (err) {
    return fail(err);
  }
  return done("AI prompt saved.");
}

export async function upsertEmailRuleAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  // Build recipient specs from the simplified form controls.
  const recipients: Array<{ type: string; value?: string }> = [];
  if (bool(fd, "toModerators")) recipients.push({ type: "moderators" });
  if (bool(fd, "toAuditors")) recipients.push({ type: "auditors" });
  if (bool(fd, "toInvolvedLead")) recipients.push({ type: "involved_lead" });
  for (const email of str(fd, "staticRecipients").split(",")) {
    const v = email.trim();
    if (v) recipients.push({ type: "static", value: v });
  }
  const dedupe = str(fd, "dedupeWindowHours");
  const trigger = str(fd, "trigger");
  const fromStatus = str(fd, "fromStatus");
  const toStatus = str(fd, "toStatus");
  const workflowType = str(fd, "workflowType");
  const hoursBefore = int(fd, "hoursBefore", 24);
  const conditions: Record<string, unknown> = {};
  if (fromStatus) conditions.from_status = fromStatus;
  if (toStatus) conditions.to_status = toStatus;
  if (workflowType) conditions.workflow_type = workflowType;
  if (trigger === "followup_reminder") conditions.hours_before = Math.max(1, hoursBefore);
  const cron = str(fd, "cron");
  const timezone = str(fd, "timezone") || "Africa/Cairo";
  try {
    await upsertEmailRule({
      id: str(fd, "id") || undefined,
      name: str(fd, "name"),
      description: str(fd, "description") || null,
      trigger,
      isActive: bool(fd, "isActive"),
      recipients,
      subjectTemplate: str(fd, "subjectTemplate") || null,
      bodyTemplate: str(fd, "bodyTemplate") || null,
      conditions,
      schedule: cron ? { cron, timezone } : {},
      dedupeWindowHours: dedupe ? Number(dedupe) : null,
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/emails");
  return done("Email rule saved.");
}

export async function toggleEmailRuleAction(
  _prev: SettingsActionState,
  fd: FormData,
): Promise<SettingsActionState> {
  try {
    await toggleEmailRule(str(fd, "id"), bool(fd, "isActive"));
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/emails");
  return done("Email rule updated.");
}
