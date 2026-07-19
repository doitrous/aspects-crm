"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/permissions";
import { ActorError } from "@/lib/data/actor";
import {
  LeadTrashError,
  permanentlyDeleteTrashedLead,
  restoreTrashedLead,
  trashLead,
} from "@/lib/data/leadTrash";
import { permanentDeleteConfirmation, trashConfirmation } from "@/lib/leads/trash";

export interface DeleteLeadState { ok: boolean; message?: string; error?: string; leadId?: string }

function refreshLeadPages() {
  for (const path of ["/calendar", "/leads", "/qualified", "/booked", "/lost", "/follow-up", "/post-op", "/database", "/duplicates", "/escalations", "/financial", "/reports", "/settings"]) {
    revalidatePath(path);
  }
}

function expectedError(error: unknown): DeleteLeadState {
  if (error instanceof PermissionError) return { ok: false, error: "Only an admin or auditor may manage lead Trash." };
  if (error instanceof ActorError || error instanceof LeadTrashError) return { ok: false, error: error.message };
  console.error("lead trash operation failed", error);
  return { ok: false, error: "The Trash operation could not be completed. Please try again." };
}

export async function deleteLeadAction(_previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState> {
  const leadId = String(formData.get("leadId") ?? "").trim();
  try {
    if (String(formData.get("confirmation") ?? "").trim() !== trashConfirmation(leadId)) {
      return { ok: false, error: `Type ${trashConfirmation(leadId)} exactly to continue.` };
    }
    const result = await trashLead(leadId);
    refreshLeadPages();
    return { ok: true, leadId: result.leadId, message: `${result.leadId} was moved to Trash for 30 days.` };
  } catch (error) {
    return expectedError(error);
  }
}

export async function restoreLeadAction(_previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState> {
  const leadUid = String(formData.get("leadUid") ?? "").trim();
  try {
    const leadId = await restoreTrashedLead(leadUid);
    refreshLeadPages();
    return { ok: true, leadId, message: `${leadId} was restored with all linked history.` };
  } catch (error) {
    return expectedError(error);
  }
}

export async function permanentlyDeleteLeadAction(_previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState> {
  const leadUid = String(formData.get("leadUid") ?? "").trim();
  const leadId = String(formData.get("leadId") ?? "").trim();
  try {
    if (String(formData.get("confirmation") ?? "").trim() !== permanentDeleteConfirmation(leadId)) {
      return { ok: false, error: `Type ${permanentDeleteConfirmation(leadId)} exactly to continue.` };
    }
    const deletedLeadId = await permanentlyDeleteTrashedLead(leadUid);
    refreshLeadPages();
    return { ok: true, leadId: deletedLeadId, message: `${deletedLeadId} was permanently deleted.` };
  } catch (error) {
    return expectedError(error);
  }
}
