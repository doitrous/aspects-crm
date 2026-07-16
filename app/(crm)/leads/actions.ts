"use server";

import { revalidatePath } from "next/cache";
import {
  clearLeadEscalation,
  addFollowUpProgram,
  completeFollowUp,
  createManualLead,
  escalateLead,
  saveLeadNote,
  markLeadRead,
  scheduleFollowUp,
  setLeadTagAssignments,
  snoozeFollowUp,
  updateLeadStage,
  updateLeadProfile,
  LeadMutationError,
  updateLeadConversationLink,
} from "@/lib/data/leadMutations";
import type { PipelineStage } from "@/lib/types";
import { PermissionError } from "@/lib/auth/permissions";
import { returnLeadToDatabase, LeadWorkflowError } from "@/lib/data/leadWorkflow";
import { linkLeads, unlinkLeads, LeadRelationshipError } from "@/lib/data/leadRelationships";
import type { LeadRelationship } from "@/lib/types";

export interface LeadActionState {
  ok: string | null;
  error: string | null;
  leadId?: string;
  tags?: string[];
}

function toState(err: unknown): LeadActionState {
  if (err instanceof LeadMutationError || err instanceof LeadWorkflowError || err instanceof LeadRelationshipError) return { ok: null, error: err.message };
  if (err instanceof PermissionError) return { ok: null, error: "You do not have permission to edit leads." };
  console.error("lead mutation failed", err);
  return { ok: null, error: "The change could not be saved. Please try again." };
}

function refreshLeadLists() {
  for (const path of ["/leads", "/qualified", "/booked", "/follow-up", "/post-op", "/lost", "/database", "/calendar"]) {
    revalidatePath(path, "page");
  }
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
  return { ok: "Saved.", error: null };
}

export async function markLeadReadAction(leadId: string): Promise<LeadActionState> {
  try {
    await markLeadRead(leadId);
  } catch (err) {
    return toState(err);
  }
  refreshLeadLists();
  return { ok: "Marked as read.", error: null };
}

export async function updateLeadConversationLinkAction(leadId: string, url: string): Promise<LeadActionState & { url?: string }> {
  try {
    const saved = await updateLeadConversationLink(leadId, url);
    revalidatePath(`/leads/${leadId}`);
    return { ok: saved ? "Conversation link saved." : "Conversation link removed.", error: null, url: saved };
  } catch (err) {
    return toState(err);
  }
}

export async function updateLeadProfileAction(leadId: string, formData: FormData): Promise<LeadActionState> {
  try {
    await updateLeadProfile({
      leadId,
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      additionalPhone: String(formData.get("additionalPhone") ?? "").trim() || null,
      mrn: String(formData.get("mrn") ?? "").trim() || null,
      gender: ["male", "female"].includes(String(formData.get("gender"))) ? String(formData.get("gender")) as "male" | "female" : null,
      specialtyId: String(formData.get("specialtyId") ?? "") || null,
      specialtyIds: formData.getAll("specialtyIds").map(String),
      serviceIds: formData.getAll("serviceIds").map(String),
      doctorIds: formData.getAll("doctorIds").map(String),
    });
  } catch (err) {
    return toState(err);
  }
  refreshLeadLists();
  return { ok: "Patient information saved.", error: null };
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
  refreshLeadLists();
  return { ok: "Status saved.", error: null };
}

export async function returnLeadToDatabaseAction(leadId: string): Promise<LeadActionState> {
  try {
    await returnLeadToDatabase(leadId);
  } catch (err) {
    return toState(err);
  }
  refreshLeadLists();
  revalidatePath(`/leads/${leadId}`);
  return { ok: "Lead returned to Database. The patient record and history were retained.", error: null };
}

export async function linkLeadAction(leadId: string, formData: FormData): Promise<LeadActionState> {
  const relationship = String(formData.get("relationship") ?? "") as LeadRelationship;
  if (!["same_patient", "parent", "child", "spouse", "sibling", "relative", "same_household", "guardian", "caregiver", "related_contact", "other"].includes(relationship)) return { ok: null, error: "Choose a relationship type." };
  try {
    await linkLeads({ leadId, targetLeadId: String(formData.get("targetLeadId") ?? ""), relationship, notes: String(formData.get("notes") ?? "") });
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/leads/${leadId}`);
  return { ok: "Lead relationship saved.", error: null };
}

export async function unlinkLeadAction(leadId: string, linkId: string): Promise<LeadActionState> {
  try {
    await unlinkLeads({ leadId, linkId });
  } catch (err) {
    return toState(err);
  }
  revalidatePath(`/leads/${leadId}`);
  return { ok: "Leads unlinked. Both patient records were retained.", error: null };
}

export async function setLeadTagsAction(
  leadId: string,
  tagIds: string[],
): Promise<LeadActionState> {
  try {
    const tags = await setLeadTagAssignments(leadId, tagIds);
    refreshLeadLists();
    revalidatePath(`/leads/${leadId}`);
    return { ok: "Tags saved.", error: null, tags };
  } catch (err) {
    return toState(err);
  }
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
  revalidatePath("/escalations", "page");
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
  revalidatePath("/escalations", "page");
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
  revalidatePath("/follow-up", "page");
  revalidatePath("/post-op", "page");
  return { ok: "Follow-up scheduled.", error: null };
}

export async function addFollowUpProgramAction(leadId: string, workflowType: string): Promise<LeadActionState> {
  try {
    await addFollowUpProgram(leadId, workflowType);
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/follow-up", "page");
  revalidatePath("/post-op", "page");
  return { ok: "Follow-up program added from template.", error: null };
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
  revalidatePath("/follow-up", "page");
  revalidatePath("/post-op", "page");
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
  revalidatePath("/follow-up", "page");
  revalidatePath("/post-op", "page");
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
    refreshLeadLists();
    return { ok: "Lead created.", error: null, leadId };
  } catch (err) {
    return toState(err);
  }
}
