"use server";

import { revalidatePath } from "next/cache";
import {
  clearLeadEscalation,
  completeFollowUp,
  createManualLead,
  escalateLead,
  saveLeadNote,
  scheduleFollowUp,
  setLeadTagAssignments,
  snoozeFollowUp,
  updateLeadStage,
  LeadMutationError,
} from "@/lib/data/leadMutations";
import type { PipelineStage } from "@/lib/types";

export interface LeadActionState {
  ok: string | null;
  error: string | null;
  leadId?: string;
}

function toState(err: unknown): LeadActionState {
  if (err instanceof LeadMutationError) return { ok: null, error: err.message };
  if (err instanceof Error) return { ok: null, error: err.message || "Action failed." };
  return { ok: null, error: "Action failed." };
}

function refreshLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
  revalidatePath("/dashboard");
  revalidatePath("/follow-up");
  revalidatePath("/escalations");
  revalidatePath("/duplicates");
}

export async function saveLeadNoteAction(
  leadId: string,
  key: string,
  value: string,
): Promise<LeadActionState> {
  try {
    await saveLeadNote(leadId, key, value);
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Saved.", error: null };
}

export async function updateLeadStageAction(
  leadId: string,
  stage: PipelineStage,
  lostReasonId?: string,
  lostNotes?: string,
): Promise<LeadActionState> {
  try {
    await updateLeadStage({ leadId, stage, lostReasonId, lostNotes });
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Status saved.", error: null };
}

export async function setLeadTagsAction(
  leadId: string,
  tagIds: string[],
): Promise<LeadActionState> {
  try {
    await setLeadTagAssignments(leadId, tagIds);
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Tags saved.", error: null };
}

export async function escalateLeadAction(
  leadId: string,
  reason: string,
  severity?: string,
): Promise<LeadActionState> {
  try {
    await escalateLead({ leadId, reason, severity });
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Escalated.", error: null };
}

export async function clearLeadEscalationAction(
  leadId: string,
  note?: string,
): Promise<LeadActionState> {
  try {
    await clearLeadEscalation(leadId, note);
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Un-escalated.", error: null };
}

export async function scheduleFollowUpAction(
  leadId: string,
  workflowType: string,
  dueAt: string,
  notes?: string,
): Promise<LeadActionState> {
  try {
    await scheduleFollowUp({ leadId, workflowType, dueAt, notes });
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Follow-up scheduled.", error: null };
}

export async function completeFollowUpAction(
  leadId: string,
  followUpId?: string,
  outcome?: string,
): Promise<LeadActionState> {
  try {
    await completeFollowUp({ leadId, followUpId, outcome });
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Follow-up completed.", error: null };
}

export async function snoozeFollowUpAction(
  leadId: string,
  followUpId?: string,
  days?: number,
): Promise<LeadActionState> {
  try {
    await snoozeFollowUp({ leadId, followUpId, days });
  } catch (err) {
    return toState(err);
  }
  refreshLead(leadId);
  return { ok: "Follow-up snoozed.", error: null };
}

export async function createManualLeadAction(formData: FormData): Promise<LeadActionState> {
  try {
    const leadId = await createManualLead({
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      platform: String(formData.get("platform") ?? "manual"),
      sourceId: String(formData.get("sourceId") ?? "") || undefined,
      serviceName: String(formData.get("serviceName") ?? "") || undefined,
    });
    refreshLead(leadId);
    return { ok: "Lead created.", error: null, leadId };
  } catch (err) {
    return toState(err);
  }
}
