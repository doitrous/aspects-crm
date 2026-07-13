"use server";

import { revalidatePath } from "next/cache";
import { resolveDuplicate } from "@/lib/data";
import { mergeDuplicateFlag } from "@/lib/data/leadMutations";
import type { DuplicateDecision } from "@/lib/types";
import type { PipelineStage } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";
import { assertCan } from "@/lib/auth/permissions";

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

export async function linkDuplicateWithChoicesAction(
  flagId: string,
  choices: { nameFrom: string; mrnFrom: string; phoneFrom: string },
): Promise<DuplicateActionState> {
  try {
    const actor = await writeActor();
    assertCan(actor.role, "leads.edit");
    const db = supabaseAdmin();
    const { data: flag, error: flagError } = await db.from("lead_duplicate_flags")
      .select("lead_id,duplicate_lead_id").eq("id", flagId).single();
    if (flagError || !flag) throw new Error(flagError?.message ?? "Duplicate pair not found.");
    const { data: rows, error: leadsError } = await db.from("leads")
      .select("id,lead_id,name,mrn,phone_country_code,phone_number,normalized_phone")
      .in("id", [flag.lead_id, flag.duplicate_lead_id]);
    if (leadsError || !rows || rows.length !== 2) throw new Error(leadsError?.message ?? "Patient records not found.");
    const byHuman = new Map(rows.map((row) => [row.lead_id as string, row]));
    const canonical = rows.find((row) => row.id === flag.lead_id)!;
    const nameSource = byHuman.get(choices.nameFrom) ?? canonical;
    const mrnSource = byHuman.get(choices.mrnFrom) ?? canonical;
    const phoneSource = choices.phoneFrom === "both" ? canonical : byHuman.get(choices.phoneFrom) ?? canonical;
    if (mrnSource.id !== canonical.id && mrnSource.mrn) {
      const { error } = await db.from("leads").update({ mrn: null }).eq("id", mrnSource.id);
      if (error) throw error;
    }
    const { error: updateError } = await db.from("leads").update({
      name: nameSource.name,
      mrn: mrnSource.mrn,
      phone_country_code: phoneSource.phone_country_code,
      phone_number: phoneSource.phone_number,
      normalized_phone: phoneSource.normalized_phone,
      updated_at: new Date().toISOString(),
    }).eq("id", canonical.id);
    if (updateError) throw updateError;
    const { data: phones, error: phonesError } = await db.from("crm_lead_phones").select("country_code,phone_number,normalized_phone,label").in("lead_id", [flag.lead_id, flag.duplicate_lead_id]);
    if (phonesError) throw phonesError;
    const copied = choices.phoneFrom === "both" ? phones ?? [] : (phones ?? []).filter((phone) => phone.normalized_phone === phoneSource.normalized_phone);
    if (copied.length) {
      const { error } = await db.from("crm_lead_phones").upsert(copied.map((phone) => ({ ...phone, lead_id: canonical.id, is_primary: phone.normalized_phone === phoneSource.normalized_phone, updated_at: new Date().toISOString() })), { onConflict: "lead_id,normalized_phone" });
      if (error) throw error;
    }
    await resolveDuplicate(flagId, "linked", `Identity linked by ${actor.name}; canonical values selected in side-by-side review.`);
  } catch (error) {
    console.error("linked identity resolution failed", error);
    return { ok: null, error: duplicateError(error) };
  }
  for (const path of ["/duplicates", "/leads", "/database", "/qualified", "/follow-up", "/post-op"]) revalidatePath(path);
  return { ok: "Patient records linked; both histories and selected phone numbers were retained.", error: null };
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
