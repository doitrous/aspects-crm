"use server";

import { revalidatePath } from "next/cache";
import { resolveDuplicate } from "@/lib/data";
import { mergeDuplicateFlag } from "@/lib/data/leadMutations";
import type { DuplicateDecision } from "@/lib/types";

export async function resolveDuplicateAction(
  flagId: string,
  decision: DuplicateDecision,
  notes?: string,
): Promise<void> {
  if (decision === "merged") {
    await mergeDuplicateFlag(flagId, notes);
  } else {
    await resolveDuplicate(flagId, decision, notes);
  }
  revalidatePath("/duplicates");
  revalidatePath("/dashboard");
  revalidatePath("/leads");
}
