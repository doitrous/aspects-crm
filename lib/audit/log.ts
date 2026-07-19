import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The single, shared writer for the CRM activity trail (`audit_logs`).
 *
 * Every human edit across the CRM — leads, statuses, tags, notes, follow-ups,
 * escalations, bookings, reservation statuses, payments, reports, settings,
 * email rules, users — must land here so "who changed what, when, from what to
 * what" is answerable from one table (spec §H). Lead-specific mutation modules
 * historically inlined their own insert; new operational writes (settings,
 * auditor, email rules) route through this helper instead of duplicating it.
 *
 * System-generated actions (cron jobs, ingest, automatic email sends) pass
 * `system: true`, which records a null actor and a `source: "system"` marker in
 * metadata so they are distinguishable from human edits.
 */
export interface ActivityEntry {
  /** The real signed-in user's `crm_users.id`. Omit (with `system: true`) for automated actions. */
  actorId?: string | null;
  /** Dotted action name, e.g. `settings.tag_updated`, `report.finalized`. */
  action: string;
  /** Entity class, e.g. `setting`, `tag`, `lost_reason`, `email_rule`, `audit_report`. */
  entityType: string;
  /** Stable id of the affected row (uuid or business key). */
  entityId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /** True for automated (non-human) actions. Forces a null actor. */
  system?: boolean;
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  const metadata = {
    ...(entry.metadata ?? {}),
    source: entry.system ? "system" : "user",
  };
  const { error } = await supabaseAdmin()
    .from("audit_logs")
    .insert({
      actor_user_id: entry.system ? null : (entry.actorId ?? null),
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      old_values: entry.oldValues ?? {},
      new_values: entry.newValues ?? {},
      metadata,
    });
  // A failed audit write must not be silently swallowed: it means we changed
  // data without a trail, which the spec forbids. Surface it to the caller so
  // the whole operation is treated as failed.
  if (error) throw new Error(`logActivity(${entry.action}): ${error.message}`);
}

/** Shape returned to the (admin) activity viewer. */
export interface ActivityRow {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  metadata: Record<string, unknown>;
  isSystem: boolean;
  createdAt: string;
}

export interface ActivityFilters {
  entityType?: string;
  actorId?: string;
  actorRole?: string;
  action?: string;
  leadId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

/** Read the most recent activity entries (admin/auditor "who edited what"). */
export async function listActivity(filters: ActivityFilters = {}): Promise<ActivityRow[]> {
  let q = supabaseAdmin()
    .from("audit_logs")
    .select("id, actor_user_id, action, entity_type, entity_id, old_values, new_values, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.min(filters.limit ?? 200, 500));
  if (filters.entityType) q = q.eq("entity_type", filters.entityType);
  if (filters.actorId) q = q.eq("actor_user_id", filters.actorId);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.dateFrom) q = q.gte("created_at", `${filters.dateFrom}T00:00:00.000Z`);
  if (filters.dateTo) q = q.lte("created_at", `${filters.dateTo}T23:59:59.999Z`);

  const { data, error } = await q;
  if (error) throw new Error(`listActivity: ${error.message}`);

  const rows = data ?? [];
  const { data: deletedLeads, error: deletedError } = await supabaseAdmin()
    .from("leads")
    .select("id,lead_id")
    .not("deleted_at", "is", null);
  if (deletedError) throw new Error(`listActivity(deleted leads): ${deletedError.message}`);
  const deletedRefs = new Set((deletedLeads ?? []).flatMap((lead) => [String(lead.id), String(lead.lead_id).toLowerCase()]));
  const ids = [...new Set(rows.map((r) => r.actor_user_id as string).filter(Boolean))];
  const names = new Map<string, { name: string; role: string | null }>();
  if (ids.length) {
    const { data: users } = await supabaseAdmin()
      .from("crm_users")
      .select("id, full_name, email, role")
      .in("id", ids);
    for (const u of users ?? []) {
      names.set(u.id as string, {
        name: (u.full_name as string) || (u.email as string) || "—",
        role: (u.role as string | null) ?? null,
      });
    }
  }

  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const actor = r.actor_user_id ? names.get(r.actor_user_id as string) : null;
    return {
      id: r.id as string,
      actorId: (r.actor_user_id as string) ?? null,
      actorName: actor?.name ?? null,
      actorRole: actor?.role ?? (meta.actor_role as string | null) ?? null,
      action: r.action as string,
      entityType: r.entity_type as string,
      entityId: r.entity_id as string,
      oldValues: (r.old_values ?? {}) as Record<string, unknown>,
      newValues: (r.new_values ?? {}) as Record<string, unknown>,
      metadata: meta,
      isSystem: meta.source === "system" || r.actor_user_id === null,
      createdAt: r.created_at as string,
    };
  }).filter((row) => {
    const leadReferences = [
      row.entityType === "lead" ? row.entityId : null,
      row.oldValues.lead_id,
      row.oldValues.leadId,
      row.newValues.lead_id,
      row.newValues.leadId,
      row.metadata.lead_id,
      row.metadata.leadId,
    ].map((value) => String(value ?? "").toLowerCase()).filter(Boolean);
    if (leadReferences.some((value) => deletedRefs.has(value))) return false;
    if (filters.actorRole && row.actorRole !== filters.actorRole) return false;
    if (filters.leadId) {
      const needle = filters.leadId.toLowerCase();
      const hay = [
        row.entityId,
        row.oldValues.lead_id,
        row.oldValues.leadId,
        row.newValues.lead_id,
        row.newValues.leadId,
        row.metadata.lead_id,
        row.metadata.leadId,
      ].map((v) => String(v ?? "").toLowerCase());
      if (!hay.some((v) => v.includes(needle))) return false;
    }
    return true;
  });
}
