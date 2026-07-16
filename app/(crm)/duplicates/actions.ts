"use server";

import { revalidatePath } from "next/cache";
import { resolveDuplicate } from "@/lib/data";
import { mergeDuplicateFlag } from "@/lib/data/leadMutations";
import type { DuplicateDecision } from "@/lib/types";
import type { PipelineStage } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";
import { assertCan } from "@/lib/auth/permissions";
import type { LeadRelationship } from "@/lib/types";

export interface DuplicateActionState {
  ok: string | null;
  error: string | null;
}

export interface BulkDuplicateItem {
  flagId: string;
  keepStatus?: PipelineStage;
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
  if (error.message.includes("Assign an MRN")) {
    return "Assign an MRN to either record before linking them as the same patient.";
  }
  if (error.message.includes("separate MRN") || error.message.includes("separate MRNs")) {
    return "Assign a distinct MRN to each person before saving this relationship.";
  }
  if (error.message.includes("same canonical patient")) {
    return "These leads already use the same canonical patient. Choose Same Patient instead.";
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
  revalidatePath("/calendar");
  revalidatePath("/leads");
  revalidatePath("/database");
  return {
    ok: decision === "merged" ? "Leads merged." : decision === "linked" ? "Leads linked without merging." : "Marked as not a duplicate.",
    error: null,
  };
}

export async function samePatientDuplicateAction(flagId: string, canonicalLeadId: string, note?: string): Promise<DuplicateActionState> {
  try {
    const actor = await writeActor();
    assertCan(actor.role, "leads.edit");
    const db = supabaseAdmin();
    const { data: canonical, error } = await db.from("leads").select("id").eq("lead_id", canonicalLeadId).maybeSingle();
    if (error || !canonical) throw new Error("Canonical lead not found.");
    const { error: rpcError } = await db.rpc("crm_link_duplicate_same_patient", { target_flag_id: flagId, canonical_lead_id: canonical.id, actor_id: actor.id, moderator_note: note?.trim() || null });
    if (rpcError) throw rpcError;
  } catch (error) {
    console.error("same patient duplicate resolution failed", error);
    return { ok: null, error: duplicateError(error) };
  }
  for (const path of ["/duplicates", "/leads", "/database"]) revalidatePath(path);
  return { ok: "Both leads now use one canonical patient identity; all original lead history was retained.", error: null };
}

export async function relatedDuplicateAction(flagId: string, relationship: LeadRelationship, note?: string): Promise<DuplicateActionState> {
  try {
    const actor = await writeActor();
    assertCan(actor.role, "leads.edit");
    const db = supabaseAdmin();
    const { error } = await db.rpc("crm_resolve_duplicate_relationship", { target_flag_id: flagId, relationship_type: relationship, actor_id: actor.id, moderator_note: note?.trim() || null });
    if (error) throw error;
  } catch (error) {
    console.error("related duplicate resolution failed", error);
    return { ok: null, error: duplicateError(error) };
  }
  for (const path of ["/duplicates", "/leads", "/database"]) revalidatePath(path);
  return { ok: "Relationship saved; each person keeps a separate patient record and MRN.", error: null };
}

export async function bulkResolveDuplicatesAction(
  items: BulkDuplicateItem[],
  decision: "merged" | "linked",
): Promise<DuplicateActionState & { processed: number; failed: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: null, error: "Select at least one duplicate pair.", processed: 0, failed: 0 };
  }
  if (items.length > 30) {
    return { ok: null, error: "Bulk actions are limited to the 30 pairs shown on this page.", processed: 0, failed: items.length };
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const safeItems = items.filter((item) => uuid.test(item.flagId));
  let processed = 0;
  let failed = items.length - safeItems.length;
  for (const item of safeItems) {
    try {
      if (decision === "merged") {
        await mergeDuplicateFlag(item.flagId, "Bulk merged from Duplicates Review", item.keepStatus);
      } else {
        await resolveDuplicate(item.flagId, "linked", "Bulk linked from Duplicates Review");
      }
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error("bulk duplicate resolution item failed", {
        flagId: item.flagId,
        decision,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  for (const path of ["/duplicates", "/calendar", "/leads", "/database"]) revalidatePath(path);
  const action = decision === "merged" ? "merged" : "linked";
  return {
    ok: processed ? `${processed} duplicate pair${processed === 1 ? "" : "s"} ${action}.` : null,
    error: failed ? `${failed} pair${failed === 1 ? "" : "s"} could not be ${action}. Review overlapping pairs or financial records.` : null,
    processed,
    failed,
  };
}
