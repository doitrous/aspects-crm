import "server-only";
import { assertCan } from "@/lib/auth/permissions";
import { writeActor } from "@/lib/data/actor";
import { supabaseAdmin } from "@/lib/supabase/server";

export class LeadWorkflowError extends Error {}

/** Remove a lead from every operational pipeline while retaining the full
 * patient record, history, payments, and identifiers in Database. */
export async function returnLeadToDatabase(leadId: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "leads.returnToDatabase");
  const db = supabaseAdmin();
  const { data: lead, error: readError } = await db
    .from("leads")
    .select("id,lead_id,status,metadata")
    .eq("lead_id", leadId)
    .is("deleted_at", null)
    .is("merged_into_lead_id", null)
    .maybeSingle();
  if (readError) throw new Error(`returnLeadToDatabase(read): ${readError.message}`);
  if (!lead) throw new LeadWorkflowError("Lead not found.");
  const previous = (lead.metadata ?? {}) as Record<string, unknown>;
  if (previous.database_only === true) return;
  const now = new Date().toISOString();
  const metadata = {
    ...previous,
    database_only: true,
    database_only_at: now,
    database_only_by: actor.id,
    database_previous_status: lead.status,
  };
  const { error } = await db.from("leads").update({
    metadata,
    has_unread: false,
    unread_since: null,
    is_reply_overdue: false,
    reply_overdue_at: null,
    updated_at: now,
  }).eq("id", lead.id);
  if (error) throw new Error(`returnLeadToDatabase: ${error.message}`);

  await Promise.all([
    db.from("audit_logs").insert({
      actor_user_id: actor.id,
      action: "lead.returned_to_database",
      entity_type: "lead",
      entity_id: lead.id,
      old_values: { database_only: false, status: lead.status },
      new_values: { database_only: true, status: null },
      metadata: { lead_id: leadId, retained_status_for_schema: lead.status, actor_name: actor.name },
    }),
    db.from("lead_timeline_events").insert({
      lead_id: lead.id,
      event_type: "returned_to_database",
      title: "Returned to Database",
      body: "Removed from operational queues. The patient record and all history were retained.",
      actor_user_id: actor.id,
      metadata: { previous_status: lead.status },
    }),
  ]);
}
