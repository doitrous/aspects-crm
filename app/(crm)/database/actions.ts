"use server";

import { revalidatePath } from "next/cache";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { ActorError, writeActor } from "@/lib/data/actor";
import { logActivity } from "@/lib/audit/log";
import { supabaseAdmin } from "@/lib/supabase/server";

export interface DeleteLeadState { ok: boolean; message?: string; error?: string }
const BULK_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

function refreshLeadPages() {
  for (const path of ["/calendar", "/leads", "/qualified", "/booked", "/lost", "/follow-up", "/post-op", "/database", "/duplicates", "/escalations", "/financial", "/reports"]) revalidatePath(path);
}

function expectedError(error: unknown): DeleteLeadState {
  if (error instanceof PermissionError) return { ok: false, error: "Only an admin or auditor may permanently delete leads." };
  if (error instanceof ActorError) return { ok: false, error: error.message };
  console.error("lead deletion failed", error);
  return { ok: false, error: "The lead could not be deleted. A linked record may require attention first." };
}

export async function deleteLeadAction(_previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState> {
  const leadId = String(formData.get("leadId") ?? "").trim();
  try {
    const actor = await writeActor();
    assertCan(actor.role, "leads.delete");
    if (String(formData.get("warningOne")) !== "acknowledged" || String(formData.get("warningTwo")) !== "acknowledged") return { ok: false, error: "Both permanent-deletion warnings must be acknowledged." };
    if (String(formData.get("confirmation") ?? "").trim() !== `DELETE ${leadId}`) return { ok: false, error: `Type DELETE ${leadId} exactly to continue.` };
    const db = supabaseAdmin();
    const { data: lead, error: readError } = await db.from("leads").select("id,lead_id,name,status,platform,created_at").eq("lead_id", leadId).maybeSingle();
    if (readError) throw readError;
    if (!lead) return { ok: false, error: "Lead not found. It may already have been deleted." };
    await logActivity({ actorId: actor.id, action: "lead.deletion_requested", entityType: "lead", entityId: String(lead.id), oldValues: { lead_id: lead.lead_id, name: lead.name, status: lead.status, platform: lead.platform, created_at: lead.created_at }, metadata: { warning_count: 2, actor_role: actor.role } });
    const { error } = await db.from("leads").delete().eq("id", lead.id);
    if (error) throw error;
    await logActivity({ actorId: actor.id, action: "lead.deleted", entityType: "lead", entityId: String(lead.id), oldValues: { lead_id: lead.lead_id, name: lead.name, status: lead.status, platform: lead.platform }, metadata: { warning_count: 2, actor_role: actor.role } });
    refreshLeadPages();
    return { ok: true, message: `${leadId} was permanently deleted.` };
  } catch (error) { return expectedError(error); }
}

export async function deleteAllLeadsAction(_previous: DeleteLeadState, formData: FormData): Promise<DeleteLeadState> {
  try {
    const actor = await writeActor();
    assertCan(actor.role, "leads.delete");
    if (String(formData.get("warningOne")) !== "acknowledged" || String(formData.get("warningTwo")) !== "acknowledged") return { ok: false, error: "Both permanent-deletion warnings must be acknowledged." };
    if (String(formData.get("confirmation") ?? "").trim() !== "DELETE ALL LEADS") return { ok: false, error: "Type DELETE ALL LEADS exactly to continue." };
    const db = supabaseAdmin();
    const { count, error: countError } = await db.from("leads").select("id", { count: "exact", head: true });
    if (countError) throw countError;
    const total = count ?? 0;
    await logActivity({ actorId: actor.id, action: "leads.bulk_deletion_requested", entityType: "lead_database", entityId: BULK_ENTITY_ID, oldValues: { lead_count: total }, metadata: { warning_count: 2, actor_role: actor.role } });
    if (total > 0) {
      const { error } = await db.from("leads").delete().not("id", "is", null);
      if (error) throw error;
    }
    await logActivity({ actorId: actor.id, action: "leads.bulk_deleted", entityType: "lead_database", entityId: BULK_ENTITY_ID, oldValues: { lead_count: total }, newValues: { lead_count: 0 }, metadata: { warning_count: 2, actor_role: actor.role } });
    refreshLeadPages();
    return { ok: true, message: `${total} lead${total === 1 ? "" : "s"} permanently deleted. The lead database is now empty.` };
  } catch (error) { return expectedError(error); }
}
