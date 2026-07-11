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
    const detail = error instanceof Error && error.message.includes("Both leads have financial records")
      ? "Both leads have financial records. Reconcile their payments before merging."
      : "The duplicate decision could not be saved. Please retry or review the audit log.";
    return { ok: null, error: detail };
  }
  revalidatePath("/duplicates");
  revalidatePath("/dashboard");
  revalidatePath("/leads");
  revalidatePath("/database");
  return { ok: decision === "merged" ? "Leads merged." : "Marked as not a duplicate.", error: null };
}
