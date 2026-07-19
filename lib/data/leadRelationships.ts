import "server-only";
import { assertCan } from "@/lib/auth/permissions";
import { writeActor } from "@/lib/data/actor";
import type { LeadRelationship } from "@/lib/types";
import { supabaseAdmin } from "@/lib/supabase/server";

export class LeadRelationshipError extends Error {}

const RELATIONSHIP_LABEL: Record<LeadRelationship, string> = {
  same_patient: "Same patient",
  parent: "Parent",
  child: "Child",
  spouse: "Spouse",
  sibling: "Sibling",
  relative: "Relative",
  same_household: "Same household",
  guardian: "Guardian",
  caregiver: "Caregiver",
  related_contact: "Related contact",
  other: "Other",
};

async function leadByHumanId(leadId: string) {
  const { data, error } = await supabaseAdmin().from("leads")
    .select("id,lead_id,name")
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .is("merged_into_lead_id", null)
    .maybeSingle();
  if (error) throw new Error(`leadRelationship(resolve): ${error.message}`);
  if (!data) throw new LeadRelationshipError(`Lead ${leadId} was not found.`);
  return data as { id: string; lead_id: string; name: string | null };
}

export async function linkLeads(input: { leadId: string; targetLeadId: string; relationship: LeadRelationship; notes?: string }): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "leads.edit");
  const [lead, target] = await Promise.all([leadByHumanId(input.leadId), leadByHumanId(input.targetLeadId)]);
  if (lead.id === target.id) throw new LeadRelationshipError("A lead cannot be linked to itself.");
  const [leadAId, leadBId] = lead.id < target.id ? [lead.id, target.id] : [target.id, lead.id];
  const db = supabaseAdmin();
  const { error: clearError } = await db.from("crm_lead_links")
    .delete().eq("lead_a_id", leadAId).eq("lead_b_id", leadBId);
  if (clearError) throw new Error(`linkLeads(clear): ${clearError.message}`);
  const { data: link, error } = await db.from("crm_lead_links").insert({
    lead_a_id: leadAId,
    lead_b_id: leadBId,
    relationship: input.relationship,
    relationship_source_lead_id: lead.id,
    linked_by: actor.id,
    notes: input.notes?.trim() || null,
  }).select("id").single();
  if (error) throw new Error(`linkLeads: ${error.message}`);
  const label = RELATIONSHIP_LABEL[input.relationship];
  await Promise.all([
    db.from("audit_logs").insert({ actor_user_id: actor.id, action: "lead.relationship_linked", entity_type: "lead_link", entity_id: link.id, new_values: { lead_a_id: leadAId, lead_b_id: leadBId, relationship: input.relationship }, metadata: { lead_id: input.leadId, target_lead_id: input.targetLeadId } }),
    db.from("lead_timeline_events").insert([
      { lead_id: lead.id, event_type: "lead_linked", title: `Linked to ${target.lead_id} · ${label}`, actor_user_id: actor.id, metadata: { link_id: link.id, target_lead_id: target.lead_id, relationship: input.relationship } },
      { lead_id: target.id, event_type: "lead_linked", title: `Linked to ${lead.lead_id} · ${label}`, actor_user_id: actor.id, metadata: { link_id: link.id, target_lead_id: lead.lead_id, relationship: input.relationship } },
    ]),
  ]);
}

export async function unlinkLeads(input: { leadId: string; linkId: string }): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "leads.edit");
  const lead = await leadByHumanId(input.leadId);
  const db = supabaseAdmin();
  const { data: link, error: readError } = await db.from("crm_lead_links")
    .select("id,lead_a_id,lead_b_id,relationship,relationship_source_lead_id,notes")
    .eq("id", input.linkId)
    .maybeSingle();
  if (readError) throw new Error(`unlinkLeads(read): ${readError.message}`);
  if (!link || (link.lead_a_id !== lead.id && link.lead_b_id !== lead.id)) throw new LeadRelationshipError("This relationship is no longer available.");
  const targetUid = link.lead_a_id === lead.id ? link.lead_b_id : link.lead_a_id;
  const { data: target } = await db.from("leads").select("lead_id").eq("id", targetUid).is("deleted_at", null).maybeSingle();
  const { error } = await db.from("crm_lead_links").delete().eq("id", input.linkId);
  if (error) throw new Error(`unlinkLeads: ${error.message}`);
  await Promise.all([
    db.from("audit_logs").insert({ actor_user_id: actor.id, action: "lead.relationship_unlinked", entity_type: "lead_link", entity_id: input.linkId, old_values: link, metadata: { lead_id: input.leadId, target_lead_id: target?.lead_id ?? null } }),
    db.from("lead_timeline_events").insert([
      { lead_id: lead.id, event_type: "lead_unlinked", title: `Unlinked from ${target?.lead_id ?? "lead"}`, actor_user_id: actor.id, metadata: { link_id: input.linkId } },
      { lead_id: targetUid, event_type: "lead_unlinked", title: `Unlinked from ${lead.lead_id}`, actor_user_id: actor.id, metadata: { link_id: input.linkId } },
    ]),
  ]);
}
