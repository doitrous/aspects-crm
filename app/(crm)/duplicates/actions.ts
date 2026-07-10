"use server";

import { revalidatePath } from "next/cache";
import { resolveDuplicate } from "@/lib/data";
import type { DuplicateDecision } from "@/lib/types";

export async function resolveDuplicateAction(
  flagId: string,
  decision: DuplicateDecision,
): Promise<void> {
  await resolveDuplicate(flagId, decision);
  revalidatePath("/duplicates");
  revalidatePath("/dashboard");
  revalidatePath("/leads");
}
