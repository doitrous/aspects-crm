"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor, ActorError } from "@/lib/data/actor";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { FinancialError, saveQuote, addTransaction } from "@/lib/data/financials";
import { createManualLead } from "@/lib/data/leadMutations";
import { logActivity } from "@/lib/audit/log";
import type { ImportMethod } from "@/lib/financial/importMapping";

export interface ImportRowInput {
  rowIndex: number;
  leadId?: string;
  mrn?: string;
  phone?: string;
  name?: string;
  age?: string;
  patientType?: string;
  source?: string;
  doctorCode?: string;
  doctorName?: string;
  specialtyName?: string;
  serviceCode?: string;
  serviceName?: string;
  serviceDate?: string;
  basePrice: number | null;
  quotedPrice: number | null;
  consumables?: number | null;
  doctorPercent?: number | null;
  netAfterConsumablesDoctorPercent?: number | null;
  amountPaid: number | null;
  method: ImportMethod | null;
  paymentByDoctor?: number | null;
  externalPayments?: number | null;
}

export interface ImportRowResult {
  rowIndex: number;
  status: "imported" | "unresolved" | "needs_approval" | "error";
  leadId?: string;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  imported: number;
  unresolved: number;
  needsApproval: number;
  failed: number;
  rows: ImportRowResult[];
}

function digits(v: string | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

/**
 * Resolve a spreadsheet row to an existing lead by Lead ID -> MRN -> phone.
 * Creation happens only later, after match attempts fail and the row contains
 * a patient name + phone. That keeps duplicate prevention first.
 */
async function resolveLead(row: ImportRowInput): Promise<string | null> {
  const db = supabaseAdmin();
  if (row.leadId) {
    const { data } = await db.from("leads").select("lead_id").eq("lead_id", row.leadId.trim()).maybeSingle();
    if (data) return data.lead_id as string;
  }
  if (row.mrn) {
    const { data } = await db.from("leads").select("lead_id").eq("mrn", row.mrn.trim()).maybeSingle();
    if (data) return data.lead_id as string;
  }
  const phone = digits(row.phone);
  if (phone.length >= 7) {
    const tail = phone.slice(-9);
    const { data } = await db
      .from("leads")
      .select("lead_id,normalized_phone")
      .ilike("normalized_phone", `%${tail}`)
      .limit(1);
    if (data && data.length) return data[0].lead_id as string;
  }
  return null;
}

async function resolveSourceId(source: string | undefined): Promise<string | undefined> {
  const label = source?.trim();
  if (!label) return undefined;
  const { data: byKey } = await supabaseAdmin()
    .from("lead_sources")
    .select("id,key,label")
    .ilike("key", label)
    .limit(1)
    .maybeSingle();
  if (byKey?.id) return byKey.id as string;
  const { data: byLabel } = await supabaseAdmin()
    .from("lead_sources")
    .select("id,key,label")
    .ilike("label", label)
    .limit(1)
    .maybeSingle();
  return (byLabel?.id as string | undefined) ?? undefined;
}

async function applyLeadImportHints(leadId: string, row: ImportRowInput): Promise<void> {
  const { data } = await supabaseAdmin()
    .from("leads")
    .select("id,service_name,initial_price")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (!data) return;
  const patch: Record<string, unknown> = {};
  const importedService = row.serviceName?.trim() || row.serviceCode?.trim();
  if (importedService && !data.service_name) patch.service_name = importedService;
  if (row.basePrice != null && data.initial_price == null) patch.initial_price = row.basePrice;
  if (Object.keys(patch).length === 0) return;
  await supabaseAdmin().from("leads").update(patch).eq("id", data.id as string);
}

function reviewSuffix(row: ImportRowInput): string {
  const notes: string[] = [];
  if (row.doctorName || row.doctorCode) notes.push(`doctor=${row.doctorName || row.doctorCode}`);
  if (row.specialtyName) notes.push(`specialty=${row.specialtyName}`);
  if (row.consumables != null) notes.push(`consumables=${row.consumables}`);
  if (row.doctorPercent != null || row.netAfterConsumablesDoctorPercent != null) notes.push("doctor compensation columns need review");
  if (row.paymentByDoctor != null) notes.push(`payment by doctor=${row.paymentByDoctor}`);
  if (row.externalPayments != null) notes.push(`external payments=${row.externalPayments}`);
  return notes.length ? ` Review: ${notes.join("; ")}.` : "";
}

/**
 * Bulk-import financial rows into the canonical tables by reusing `saveQuote`
 * (freezes base price, enforces the discount ceiling, audits) and
 * `addTransaction` (append-only ledger). Admin/Auditor only. Row-by-row
 * results are returned — nothing is silently dropped, and a discount below the
 * allowed ceiling is reported as `needs_approval` rather than force-imported.
 */
export async function importFinancialRows(rows: ImportRowInput[]): Promise<ImportResult> {
  let actor: Awaited<ReturnType<typeof writeActor>>;
  try {
    actor = await writeActor();
    assertCan(actor.role, "financial.bulkImport");
  } catch (err) {
    if (err instanceof PermissionError) return emptyResult("You are not authorized to import financial data.");
    if (err instanceof ActorError) return emptyResult(err.message);
    throw err;
  }

  const results: ImportRowResult[] = [];
  for (const row of rows) {
    if (row.quotedPrice == null || row.basePrice == null) {
      results.push({ rowIndex: row.rowIndex, status: "error", message: "Missing base or quoted price." });
      continue;
    }
    let leadId = await resolveLead(row);
    let createdLead = false;
    if (!leadId && row.name?.trim() && row.phone?.trim()) {
      try {
        leadId = await createManualLead({
          name: row.name,
          phone: row.phone,
          platform: "manual",
          sourceId: await resolveSourceId(row.source),
          serviceName: row.serviceName || row.serviceCode,
        });
        createdLead = true;
      } catch (err) {
        results.push({ rowIndex: row.rowIndex, status: "error", message: `Could not create lead: ${(err as Error).message}` });
        continue;
      }
    }
    if (!leadId) {
      results.push({ rowIndex: row.rowIndex, status: "unresolved", message: "No matching lead and no safe Name + Phone identity to create one." });
      continue;
    }
    try {
      await applyLeadImportHints(leadId, row);
      await saveQuote({
        leadId,
        quotedPrice: row.quotedPrice,
        serviceDate: row.serviceDate || null,
        financialNotes: `Bulk import row ${row.rowIndex + 1}.${reviewSuffix(row)}`,
      });
    } catch (err) {
      if (err instanceof FinancialError) {
        // Below-allowed discount → surface for approval, don't silently force.
        results.push({ rowIndex: row.rowIndex, status: "needs_approval", leadId, message: err.message });
        continue;
      }
      results.push({ rowIndex: row.rowIndex, status: "error", leadId, message: (err as Error).message });
      continue;
    }

    // Optional payment line.
    if (row.amountPaid != null && row.amountPaid > 0) {
      try {
        await addTransaction({
          leadId,
          kind: "payment",
          amount: row.amountPaid,
          method: row.method ?? "other",
          occurredOn: row.serviceDate || undefined,
          note: `Bulk import row ${row.rowIndex + 1}.${reviewSuffix(row)}`,
        });
      } catch (err) {
        results.push({ rowIndex: row.rowIndex, status: "imported", leadId, message: `Quote saved; payment failed: ${(err as Error).message}` });
        continue;
      }
    }
    results.push({ rowIndex: row.rowIndex, status: "imported", leadId, message: createdLead ? "Created lead and imported." : "Imported." });
  }

  revalidatePath("/financial");
  revalidatePath("/financial/import");
  revalidatePath("/bulk-import");
  revalidatePath("/leads");

  await logActivity({
    actorId: actor.id,
    action: "import.bulk_financial",
    entityType: "bulk_import",
    entityId: randomUUID(),
    newValues: {
      total: rows.length,
      imported: results.filter((r) => r.status === "imported").length,
      unresolved: results.filter((r) => r.status === "unresolved").length,
      needs_approval: results.filter((r) => r.status === "needs_approval").length,
      failed: results.filter((r) => r.status === "error").length,
    },
    metadata: {
      actor_name: actor.name,
      actor_role: actor.role,
      row_results: results,
    },
  });

  return {
    ok: true,
    imported: results.filter((r) => r.status === "imported").length,
    unresolved: results.filter((r) => r.status === "unresolved").length,
    needsApproval: results.filter((r) => r.status === "needs_approval").length,
    failed: results.filter((r) => r.status === "error").length,
    rows: results,
  };
}

function emptyResult(error: string): ImportResult {
  return { ok: false, error, imported: 0, unresolved: 0, needsApproval: 0, failed: 0, rows: [] };
}
