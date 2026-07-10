"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/permissions";
import { ActorError } from "@/lib/data/actor";
import {
  SettingsError,
  upsertTag,
  upsertLostReason,
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
}

const IDLE: SettingsActionState = { ok: false };
export { IDLE as SETTINGS_IDLE };

/** Map known, user-facing errors to state; rethrow anything unexpected. */
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
  throw err;
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
  try {
    await upsertEmailRule({
      id: str(fd, "id") || undefined,
      name: str(fd, "name"),
      description: str(fd, "description") || null,
      trigger: str(fd, "trigger"),
      isActive: bool(fd, "isActive"),
      recipients,
      subjectTemplate: str(fd, "subjectTemplate") || null,
      bodyTemplate: str(fd, "bodyTemplate") || null,
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
