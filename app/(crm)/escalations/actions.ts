"use server";

import { revalidatePath } from "next/cache";
import { resolveEscalation } from "@/lib/data";

export async function resolveEscalationAction(id: string): Promise<void> {
  await resolveEscalation(id);
  revalidatePath("/escalations");
  revalidatePath("/dashboard");
}
