"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor, ActorError } from "@/lib/data/actor";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { FinancialError, saveQuote, addTransaction } from "@/lib/data/financials";
import type { ImportMethod } from "@/lib/financial/importMapping";

export interface ImportRowInput {
  rowIndex: number;
  leadId?: string;
  mrn?: string;
  phone?: string;
  serviceName?: string;
  serviceDate?: string;
  basePrice: number | null;
  quotedPrice: number | null;
  amountPaid: number | null;
  method: ImportMethod | null;
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
 * Resolve a spreadsheet row to an EXISTING lead by Lead ID → MRN → phone.
 * Deliberately match-only: unmatched rows are reported for review, never
 * auto-created, so a bulk import cannot spawn duplicate leads (§36).
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

/**
 * Bulk-import financial rows into the canonical tables by reusing `saveQuote`
 * (freezes base price, enforces the discount ceiling, audits) and
 * `addTransaction` (append-only ledger). Admin/Auditor only. Row-by-row
 * results are returned — nothing is silently dropped, and a discount below the
 * allowed ceiling is reported as `needs_approval` rather than force-imported.
 */
export async function importFinancialRows(rows: ImportRowInput[]): Promise<ImportResult> {
  try {
    const actor = await writeActor();
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
    const leadId = await resolveLead(row);
    if (!leadId) {
      results.push({ rowIndex: row.rowIndex, status: "unresolved", message: "No matching lead (by Lead ID / MRN / phone)." });
      continue;
    }
    try {
      await saveQuote({
        leadId,
        quotedPrice: row.quotedPrice,
        serviceDate: row.serviceDate || null,
        financialNotes: `Bulk import row ${row.rowIndex + 1}`,
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
          note: `Bulk import row ${row.rowIndex + 1}`,
        });
      } catch (err) {
        results.push({ rowIndex: row.rowIndex, status: "imported", leadId, message: `Quote saved; payment failed: ${(err as Error).message}` });
        continue;
      }
    }
    results.push({ rowIndex: row.rowIndex, status: "imported", leadId, message: "Imported." });
  }

  revalidatePath("/financial");
  revalidatePath("/leads");

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
