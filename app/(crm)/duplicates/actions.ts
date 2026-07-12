"use server";

import { revalidatePath } from "next/cache";
import { resolveDuplicate } from "@/lib/data";
import { mergeDuplicateFlag } from "@/lib/data/leadMutations";
import type { DuplicateDecision } from "@/lib/types";
import type { PipelineStage } from "@/lib/types";

export interface DuplicateActionState {
  ok: string | null;
  error: string | null;
}

function duplicateError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "The duplicate decision could not be saved. Please retry or review the audit log.";
  }
  if (error.message.includes("Both leads have financial records")) {
    return "Both leads have financial records. Reconcile their payments before merging.";
  }
  if (error.message.includes("lead_stage_history")) {
    return "The duplicate-merge database repair has not been applied yet. Ask an administrator to apply migration 0021.";
  }
  return "The duplicate decision could not be saved. Please retry or review the audit log.";
}

export async function resolveDuplicateAction(
  flagId: string,
  decision: DuplicateDecision,
  notes?: string,
  keepStatus?: PipelineStage,
): Promise<DuplicateActionState> {
  try {
    if (decision === "merged") {
      await mergeDuplicateFlag(flagId, notes, keepStatus);
    } else {
      await resolveDuplicate(flagId, decision, notes);
    }
  } catch (error) {
    console.error("duplicate resolution failed", error);
    return { ok: null, error: duplicateError(error) };
  }
  revalidatePath("/duplicates");
  revalidatePath("/dashboard");
  revalidatePath("/leads");
  revalidatePath("/database");
  return { ok: decision === "merged" ? "Leads merged." : "Marked as not a duplicate.", error: null };
}
