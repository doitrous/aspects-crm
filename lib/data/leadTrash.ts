import "server-only";

import { assertCan } from "@/lib/auth/permissions";
import { writeActor } from "@/lib/data/actor";
import { requireSession } from "@/lib/data/session";
import { supabaseAdmin } from "@/lib/supabase/server";

export class LeadTrashError extends Error {}

export interface TrashedLead {
  id: string;
  leadId: string;
  patientName: string;
  phone: string;
  platform: string | null;
  deletedAt: string;
  purgeAfter: string;
  deletedBy: string;
}

type TrashRow = {
  id: string;
  lead_id: string;
  name: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  normalized_phone: string | null;
  platform: string | null;
  deleted_at: string;
  purge_after: string;
  deleted_by: string | null;
};

export async function purgeExpiredLeadTrash(): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("crm_purge_expired_lead_trash");
  if (error) throw new LeadTrashError(`Expired trash could not be purged: ${error.message}`);
  return Number(data ?? 0);
}

export async function listTrashedLeads(): Promise<TrashedLead[]> {
  const { effective } = await requireSession();
  assertCan(effective.role, "leads.delete");
  await purgeExpiredLeadTrash();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("leads")
    .select("id,lead_id,name,phone_country_code,phone_number,normalized_phone,platform,deleted_at,purge_after,deleted_by")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .returns<TrashRow[]>();
  if (error) throw new LeadTrashError(`Lead trash could not be loaded: ${error.message}`);

  const actorIds = [...new Set((data ?? []).map((row) => row.deleted_by).filter((id): id is string => Boolean(id)))];
  const users = actorIds.length
    ? await db.from("crm_users").select("id,full_name,email").in("id", actorIds)
    : { data: [], error: null };
  if (users.error) throw new LeadTrashError(`Trash actor names could not be loaded: ${users.error.message}`);
  const names = new Map((users.data ?? []).map((user) => [
    user.id as string,
    ((user.full_name as string | null) || (user.email as string | null) || "Unknown user").trim(),
  ]));

  return (data ?? []).map((row) => ({
    id: row.id,
    leadId: row.lead_id,
    patientName: row.name?.trim() || "Unnamed lead",
    phone: [row.phone_country_code, row.phone_number].filter(Boolean).join(" ") || row.normalized_phone || "—",
    platform: row.platform,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    deletedBy: row.deleted_by ? names.get(row.deleted_by) ?? "Unknown user" : "Unknown user",
  }));
}

export async function trashLead(humanLeadId: string): Promise<{ leadId: string; purgeAfter: string }> {
  const actor = await writeActor();
  assertCan(actor.role, "leads.delete");
  const db = supabaseAdmin();
  const { data: lead, error: readError } = await db
    .from("leads")
    .select("id,lead_id")
    .eq("lead_id", humanLeadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (readError) throw new LeadTrashError(readError.message);
  if (!lead) throw new LeadTrashError("Lead not found. It may already be in Trash.");
  const { data, error } = await db.rpc("crm_trash_lead", {
    target_lead_id: lead.id,
    actor_id: actor.id,
  });
  if (error) throw new LeadTrashError(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.lead_id || !result?.purge_after) throw new LeadTrashError("The lead was not moved to Trash.");
  return { leadId: String(result.lead_id), purgeAfter: String(result.purge_after) };
}

export async function restoreTrashedLead(leadUid: string): Promise<string> {
  const actor = await writeActor();
  assertCan(actor.role, "leads.delete");
  await purgeExpiredLeadTrash();
  const { data, error } = await supabaseAdmin().rpc("crm_restore_trashed_lead", { target_lead_id: leadUid });
  if (error) throw new LeadTrashError(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.lead_id) throw new LeadTrashError("This lead is no longer available in Trash.");
  return String(result.lead_id);
}

export async function permanentlyDeleteTrashedLead(leadUid: string): Promise<string> {
  const actor = await writeActor();
  assertCan(actor.role, "leads.delete");
  const { data, error } = await supabaseAdmin().rpc("crm_purge_trashed_lead", { target_lead_id: leadUid });
  if (error) throw new LeadTrashError(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.lead_id) throw new LeadTrashError("This lead is no longer available in Trash.");
  return String(result.lead_id);
}
