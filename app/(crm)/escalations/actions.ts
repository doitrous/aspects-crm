"use server";

import { revalidatePath } from "next/cache";
import { resolveEscalationWorkflow } from "@/lib/data/leadMutations";

function refresh() {
  revalidatePath("/escalations");
  revalidatePath("/dashboard");
  revalidatePath("/follow-up");
  revalidatePath("/leads");
}

export async function returnEscalationAction(id: string, note?: string): Promise<void> {
  await resolveEscalationWorkflow({ escalationId: id, resolution: "returned", note });
  refresh();
}

export async function resolveEscalationAction(id: string, note?: string): Promise<void> {
  await resolveEscalationWorkflow({ escalationId: id, resolution: "resolved", note });
  refresh();
}
