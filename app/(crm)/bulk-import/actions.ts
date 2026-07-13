"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { assertCan, PermissionError } from "@/lib/auth/permissions";
import { ActorError, writeActor } from "@/lib/data/actor";
import { createManualLead, LeadMutationError } from "@/lib/data/leadMutations";
import { logActivity } from "@/lib/audit/log";
import { supabaseAdmin } from "@/lib/supabase/server";
import { forcedLeadName } from "@/lib/import/leadImportMapping";

export interface LeadImportRowInput {
  rowIndex: number;
  name?: string;
  phone?: string;
  mrn?: string;
  nationality?: string;
  gender?: "male" | "female";
  source?: string;
  serviceName?: string;
  doctorName?: string;
  specialtyName?: string;
  age?: number;
  patientType?: string;
  notes?: string;
}

export interface LeadImportRowResult {
  rowIndex: number;
  status: "imported" | "merged" | "existing" | "skipped" | "error";
  leadId?: string;
  message: string;
}

export interface LeadImportResult {
  ok: boolean;
  error?: string;
  imported: number;
  merged: number;
  existing: number;
  skipped: number;
  failed: number;
  rows: LeadImportRowResult[];
}

function digits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export interface LeadImportOptions {
  importInvalid: boolean;
  mergeSameMrn: boolean;
  mergeSamePhone: boolean;
}

interface ExistingMatch {
  match: "mrn" | "phone";
  lead: Record<string, unknown> & { id: string; lead_id: string };
}

const EXISTING_COLUMNS = "id,lead_id,name,mrn,phone_number,service_name,gender,notes,metadata";

async function existingLead(row: LeadImportRowInput): Promise<ExistingMatch | null> {
  const db = supabaseAdmin();
  if (row.mrn && /^\d{1,9}$/.test(row.mrn)) {
    const { data, error } = await db.from("leads").select(EXISTING_COLUMNS).eq("mrn", row.mrn.trim()).is("merged_into_lead_id", null).limit(1).maybeSingle();
    if (error) throw error;
    if (data?.lead_id) return { match: "mrn", lead: data as ExistingMatch["lead"] };
  }
  const phone = digits(row.phone);
  if (phone.length >= 7) {
    const { data, error } = await db.from("leads").select(EXISTING_COLUMNS).ilike("normalized_phone", `%${phone.slice(-9)}`).is("merged_into_lead_id", null).limit(1).maybeSingle();
    if (error) throw error;
    if (data?.lead_id) return { match: "phone", lead: data as ExistingMatch["lead"] };
  }
  return null;
}

async function sourceId(
  label: string | undefined,
  cache?: Map<string, string | undefined>,
): Promise<string | undefined> {
  const source = label?.trim();
  if (!source) return undefined;
  const key = source.toLocaleLowerCase();
  if (cache?.has(key)) return cache.get(key);
  const db = supabaseAdmin();
  const byKey = await db.from("lead_sources").select("id").ilike("key", source).limit(1).maybeSingle();
  if (byKey.error) throw byKey.error;
  if (byKey.data?.id) {
    const id = byKey.data.id as string;
    cache?.set(key, id);
    return id;
  }
  const byLabel = await db.from("lead_sources").select("id").ilike("label", source).limit(1).maybeSingle();
  if (byLabel.error) throw byLabel.error;
  const id = byLabel.data?.id as string | undefined;
  cache?.set(key, id);
  return id;
}

function emptyResult(error: string): LeadImportResult {
  return { ok: false, error, imported: 0, merged: 0, existing: 0, skipped: 0, failed: 0, rows: [] };
}

function identityErrors(row: LeadImportRowInput): string[] {
  const errors: string[] = [];
  if (!row.name?.trim()) errors.push("Patient name is required");
  const phone = digits(row.phone);
  if (!row.phone?.trim()) errors.push("Phone number is required");
  else if (phone.length < 7) errors.push("Phone number must contain at least 7 digits");
  if (!row.mrn?.trim()) errors.push("MRN is required");
  else if (!/^\d{1,9}$/.test(row.mrn.trim())) errors.push("MRN must contain 1 to 9 digits");
  if (!row.nationality?.trim()) errors.push("Nationality is required");
  return errors;
}

function importMetadata(row: LeadImportRowInput, errors: string[]) {
  return {
    imported_via: "patient_bulk_import",
    imported_at: new Date().toISOString(),
    import_row: row.rowIndex + 1,
    import_validation_errors: errors,
    imported_mrn_raw: row.mrn ?? null,
    nationality: row.nationality ?? null,
    source_name: row.source ?? null,
    doctor_name: row.doctorName ?? null,
    specialty_name: row.specialtyName ?? null,
    patient_age: row.age ?? null,
    patient_type: row.patientType ?? null,
  };
}

async function createForcedLead(
  row: LeadImportRowInput,
  actorId: string,
  errors: string[],
  sourceCache: Map<string, string | undefined>,
): Promise<string> {
  const db = supabaseAdmin();
  const generated = await db.rpc("crm_generate_lead_id");
  if (generated.error || !generated.data) throw generated.error ?? new Error("Could not generate Lead ID.");
  const leadId = String(generated.data);
  const validMrn = row.mrn && /^\d{1,9}$/.test(row.mrn.trim()) ? row.mrn.trim() : null;
  const { data, error } = await db.from("leads").insert({
    lead_id: leadId,
    // `leads.name` is required by the database. An explicit override must still
    // import a nameless row, so give it a traceable neutral display name while
    // preserving the validation error in metadata.
    name: forcedLeadName(row.name, row.rowIndex),
    mrn: validMrn,
    phone_country_code: row.phone?.trim() ? "+20" : null,
    phone_number: row.phone?.trim() || null,
    platform: "manual",
    source_id: await sourceId(row.source, sourceCache),
    service_name: row.serviceName?.trim() || null,
    gender: row.gender ?? null,
    notes: row.notes?.trim() || null,
    status: "new_lead",
    has_unread: false,
    escalation_status: "none",
    coordinator_user_id: actorId,
    metadata: importMetadata(row, errors),
  }).select("id,lead_id").single();
  if (error || !data) throw error ?? new Error("Could not create imported lead.");
  await db.from("lead_timeline_events").insert({ lead_id: data.id, event_type: "lead_created", title: "Lead created by bulk import", actor_user_id: actorId, metadata: { import_row: row.rowIndex + 1, forced_invalid_import: true } });
  return String(data.lead_id);
}

async function mergeImportedRow(match: ExistingMatch, row: LeadImportRowInput, errors: string[]): Promise<void> {
  const current = match.lead;
  const metadata = (current.metadata as Record<string, unknown> | null) ?? {};
  const patch: Record<string, unknown> = { metadata: { ...metadata, ...importMetadata(row, errors), bulk_merged_by: match.match }, updated_at: new Date().toISOString() };
  if (!current.name && row.name?.trim()) patch.name = row.name.trim();
  if (!current.mrn && row.mrn && /^\d{1,9}$/.test(row.mrn.trim())) patch.mrn = row.mrn.trim();
  if (!current.phone_number && row.phone?.trim()) { patch.phone_country_code = "+20"; patch.phone_number = row.phone.trim(); }
  if (!current.service_name && row.serviceName?.trim()) patch.service_name = row.serviceName.trim();
  if (!current.gender && row.gender) patch.gender = row.gender;
  if (!current.notes && row.notes?.trim()) patch.notes = row.notes.trim();
  const { error } = await supabaseAdmin().from("leads").update(patch).eq("id", current.id);
  if (error) throw error;
}

export async function importLeadRows(rows: LeadImportRowInput[], options: LeadImportOptions): Promise<LeadImportResult> {
  let actor: Awaited<ReturnType<typeof writeActor>>;
  try {
    actor = await writeActor();
    assertCan(actor.role, "leads.bulkImport");
  } catch (error) {
    if (error instanceof PermissionError) return emptyResult("Only an admin or auditor may bulk import patient leads.");
    if (error instanceof ActorError) return emptyResult(error.message);
    throw error;
  }

  if (!Array.isArray(rows) || rows.length === 0) return emptyResult("No import rows were supplied.");
  if (rows.length > 5_000) {
    return emptyResult("A single import may contain at most 5,000 rows. Split larger workbooks into smaller files.");
  }

  const results: LeadImportRowResult[] = [];
  const sourceCache = new Map<string, string | undefined>();
  for (const row of rows) {
    try {
      const errors = identityErrors(row);
      if (errors.length && !options.importInvalid) {
        results.push({ rowIndex: row.rowIndex, status: "skipped", message: errors.join("; ") });
        continue;
      }
      const existing = await existingLead(row);
      if (existing) {
        const mergeEnabled = existing.match === "mrn" ? options.mergeSameMrn : options.mergeSamePhone;
        if (mergeEnabled) {
          await mergeImportedRow(existing, row, errors);
          results.push({ rowIndex: row.rowIndex, status: "merged", leadId: existing.lead.lead_id, message: `Merged into ${existing.lead.lead_id} by exact ${existing.match.toUpperCase()} match.` });
        } else {
          results.push({ rowIndex: row.rowIndex, status: "existing", leadId: existing.lead.lead_id, message: `Matched existing lead ${existing.lead.lead_id} by ${existing.match}; enable that bulk-merge option to enrich it.` });
        }
        continue;
      }
      const leadId = errors.length ? await createForcedLead(row, actor.id, errors, sourceCache) : await createManualLead({
        name: row.name!,
        phone: row.phone!,
        mrn: row.mrn,
        gender: row.gender,
        platform: "manual",
        sourceId: await sourceId(row.source, sourceCache),
        serviceName: row.serviceName,
        notes: row.notes,
        metadata: importMetadata(row, errors),
      });
      results.push({ rowIndex: row.rowIndex, status: "imported", leadId, message: `Created regular lead ${leadId}.` });
    } catch (error) {
      console.error("Bulk lead import row failed", {
        row: row.rowIndex + 1,
        code: typeof error === "object" && error && "code" in error ? String(error.code) : undefined,
      });
      const message = error instanceof LeadMutationError
        ? error.message
        : "This row could not be imported. Review its identity fields and try again.";
      results.push({ rowIndex: row.rowIndex, status: "error", message });
    }
  }

  for (const path of ["/bulk-import", "/database", "/leads", "/calendar"]) revalidatePath(path);
  await logActivity({
    actorId: actor.id,
    action: "import.bulk_leads",
    entityType: "bulk_import",
    entityId: randomUUID(),
    newValues: {
      total: rows.length,
      imported: results.filter((row) => row.status === "imported").length,
      merged: results.filter((row) => row.status === "merged").length,
      existing: results.filter((row) => row.status === "existing").length,
      skipped: results.filter((row) => row.status === "skipped").length,
      failed: results.filter((row) => row.status === "error").length,
    },
    metadata: { actor_name: actor.name, actor_role: actor.role, row_results: results },
  });

  return {
    ok: true,
    imported: results.filter((row) => row.status === "imported").length,
    merged: results.filter((row) => row.status === "merged").length,
    existing: results.filter((row) => row.status === "existing").length,
    skipped: results.filter((row) => row.status === "skipped").length,
    failed: results.filter((row) => row.status === "error").length,
    rows: results,
  };
}
