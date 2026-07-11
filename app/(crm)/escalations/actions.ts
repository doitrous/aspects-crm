"use server";

import { revalidatePath } from "next/cache";
import { resolveEscalationWorkflow } from "@/lib/data/leadMutations";

export interface EscalationActionState {
  ok: string | null;
  error: string | null;
  href?: string;
}

function refresh(leadId: string) {
  revalidatePath("/escalations");
  revalidatePath("/leads");
  revalidatePath(`/leads/${leadId}`);
}

export async function returnEscalationAction(id: string, note?: string): Promise<EscalationActionState> {
  try {
    const result = await resolveEscalationWorkflow({ escalationId: id, resolution: "returned", note });
    refresh(result.leadId);
    return { ok: "Escalation resolved and sent back to the moderator.", error: null, href: `/leads/${result.leadId}?tab=Log` };
  } catch (error) {
    console.error("return escalation failed", error);
    return { ok: null, error: "Could not send the escalation back. Please retry." };
  }
}

export async function resolveEscalationAction(id: string, note?: string): Promise<EscalationActionState> {
  try {
    const result = await resolveEscalationWorkflow({ escalationId: id, resolution: "resolved", note });
    refresh(result.leadId);
    return { ok: "Escalation completely resolved.", error: null, href: `/leads/${result.leadId}?tab=Log` };
  } catch (error) {
    console.error("resolve escalation failed", error);
    return { ok: null, error: "Could not resolve the escalation. Please retry." };
  }
}
