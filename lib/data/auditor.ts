import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { writeActor } from "@/lib/data/actor";
import { assertCan } from "@/lib/auth/permissions";
import { logActivity } from "@/lib/audit/log";
import {
  computeAuditorMetrics,
  mergeOverrides,
  auditorRedFlags,
  type AuditorMetrics,
} from "@/lib/auditor/kpi";
import { bookingCatalog } from "@/lib/booking/service";

/**
 * Auditor Dashboard workflow (§A). The report data model already exists in the
 * baseline (`audit_daily_reports`, `audit_metric_snapshots`,
 * `audit_metric_overrides`); this module is the missing *workflow*: gather real
 * counts, generate/persist a report, record logged overrides, and finalize.
 */

export class AuditorError extends Error {}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function previousDayIso(ref = new Date()): string {
  const d = new Date(ref);
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDay(d);
}

/** Half-open [start, end) UTC bounds for a YYYY-MM-DD day. */
function dayBounds(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function targetCpl(): Promise<number> {
  const { data } = await supabaseAdmin()
    .from("auditor_settings")
    .select("target_cpl_egp")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.target_cpl_egp as number) ?? 0;
}

/** Optional doctor/specialty scope for a live filtered snapshot view. */
export interface AuditorScope {
  /** Restrict to leads handled by any of these `leads.doctor_id` values. */
  doctorIds?: string[];
}

/** All lead uuids for the scoped doctors (needed to filter escalations/payments,
 *  which carry a lead_id but no doctor_id). Empty scope → null (no filtering). */
async function scopedLeadUids(scope?: AuditorScope): Promise<string[] | null> {
  if (!scope?.doctorIds || scope.doctorIds.length === 0) return null;
  const { data } = await supabaseAdmin().from("leads").select("id").in("doctor_id", scope.doctorIds).is("deleted_at", null);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Compute the automatic metric snapshot for `date` from live CRM data.
 * Counts are of leads *created on the report date*, grouped by current status;
 * payments are collected patient payments (net of refunds/reversals) for the day.
 *
 * An optional `scope` restricts every figure to a set of doctors — the auditor
 * page maps a chosen doctor (or a whole specialty's doctors) onto this, giving a
 * genuinely filtered live view. The persisted daily report stays clinic-wide.
 */
export async function computeAutoSnapshot(date: string, scope?: AuditorScope): Promise<AuditorMetrics> {
  const db = supabaseAdmin();
  const { start, end } = dayBounds(date);
  const doctorIds = scope?.doctorIds && scope.doctorIds.length > 0 ? scope.doctorIds : null;
  const leadUids = await scopedLeadUids(scope);

  const createdLeads = () => {
    const q = db
      .from("leads")
      .select("id", { count: "exact", head: true })
      .is("deleted_at", null)
      .gte("created_at", start)
      .lt("created_at", end);
    return doctorIds ? q.in("doctor_id", doctorIds) : q;
  };

  const totalLeadsP = createdLeads();
  const statusCount = async (status: string) => (await createdLeads().eq("status", status)).count ?? 0;

  let escalationsQ = db
    .from("escalations")
    .select("id", { count: "exact", head: true })
    .gte("created_at", start)
    .lt("created_at", end);
  if (leadUids) escalationsQ = escalationsQ.in("lead_id", leadUids.length ? leadUids : ["00000000-0000-0000-0000-000000000000"]);

  let paymentsQ = db.from("crm_financial_transactions").select("amount,kind").eq("occurred_on", date);
  if (leadUids) paymentsQ = paymentsQ.in("lead_id", leadUids.length ? leadUids : ["00000000-0000-0000-0000-000000000000"]);

  const [{ count: totalLeads }, qualified, booked, dropped, escalations, payments] = await Promise.all([
    totalLeadsP,
    statusCount("qualified"),
    statusCount("booked"),
    statusCount("lost"),
    escalationsQ.then((r) => r.count ?? 0),
    paymentsQ.then((r) => {
      const rows = (r.data ?? []) as Array<{ amount: number; kind: string }>;
      let net = 0;
      for (const t of rows) {
        const a = Number(t.amount) || 0;
        if (t.kind === "payment") net += a;
        else if (t.kind === "refund" || t.kind === "reversal" || t.kind === "chargeback") net -= a;
      }
      return Math.round(net * 100) / 100;
    }),
  ]);

  return computeAuditorMetrics({
    totalLeads: totalLeads ?? 0,
    qualifiedLeads: qualified,
    bookedLeads: booked,
    droppedLeads: dropped,
    escalations,
    paymentsCollectedEgp: payments,
    marketingSpendEgp: 0, // no ad-spend source; auditor supplies via override
    targetCplEgp: await targetCpl(),
  });
}

export interface AuditReportDetail {
  date: string;
  status: string;
  notes: string | null;
  autoMetrics: AuditorMetrics;
  overrides: Record<string, { value: number; reason: string }>;
  metrics: AuditorMetrics;
  redFlags: Array<{ key: string; reason: string }>;
  generatedByName: string | null;
  submittedByName: string | null;
}

async function nameFor(id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const { data } = await supabaseAdmin().from("crm_users").select("full_name,email").eq("id", id).maybeSingle();
  return (data?.full_name as string) || (data?.email as string) || null;
}

/** Read a persisted report (with overrides merged) for `date`, or null. */
export async function getAuditReportDetail(date: string): Promise<AuditReportDetail | null> {
  const db = supabaseAdmin();
  const { data: report, error } = await db
    .from("audit_daily_reports")
    .select("*")
    .eq("report_date", date)
    .maybeSingle();
  if (error) throw new AuditorError(error.message);
  if (!report) return null;

  const auto = (report.auto_metric_snapshot ?? {}) as AuditorMetrics;
  const { data: overrideRows } = await db
    .from("audit_metric_overrides")
    .select("metric_key,override_value,reason")
    .eq("daily_report_id", report.id as string);
  const overrides: Record<string, { value: number; reason: string }> = {};
  const overrideMetrics: AuditorMetrics = {};
  for (const o of overrideRows ?? []) {
    overrides[o.metric_key as string] = {
      value: Number(o.override_value),
      reason: (o.reason as string) ?? "",
    };
    overrideMetrics[o.metric_key as string] = Number(o.override_value);
  }
  const metrics = mergeOverrides(auto, overrideMetrics);

  return {
    date: report.report_date as string,
    status: (report.status as string) ?? "draft",
    notes: (report.notes as string) ?? null,
    autoMetrics: auto,
    overrides,
    metrics,
    redFlags: auditorRedFlags(metrics),
    generatedByName: await nameFor(report.created_by as string),
    submittedByName: await nameFor(report.submitted_by as string),
  };
}

/**
 * Generate (or refresh the auto snapshot of) the daily report for `date`.
 * Idempotent on report_date; preserves existing overrides and status unless the
 * report was already finalized (then refuse to avoid clobbering signed work).
 */
export async function generateAuditReport(date: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "reports.generate");
  const db = supabaseAdmin();

  const { data: existing } = await db
    .from("audit_daily_reports")
    .select("id,status")
    .eq("report_date", date)
    .maybeSingle();
  if (existing && (existing.status === "submitted" || existing.status === "approved")) {
    throw new AuditorError("This report is finalized. Reopen it before refreshing the snapshot.");
  }

  const auto = await computeAutoSnapshot(date);
  const nowIso = new Date().toISOString();

  let reportId: string;
  if (existing) {
    const { error } = await db
      .from("audit_daily_reports")
      .update({ auto_metric_snapshot: auto, updated_at: nowIso })
      .eq("id", existing.id as string);
    if (error) throw new AuditorError(error.message);
    reportId = existing.id as string;
  } else {
    const { data, error } = await db
      .from("audit_daily_reports")
      .insert({
        report_date: date,
        created_by: actor.id,
        status: "draft",
        auto_metric_snapshot: auto,
      })
      .select("id")
      .single();
    if (error) throw new AuditorError(error.message);
    reportId = data.id as string;
  }

  // Persist per-metric snapshot rows so drill-downs and history are queryable.
  const snapshotRows = Object.entries(auto).map(([metric_key, auto_value]) => ({
    daily_report_id: reportId,
    metric_key,
    auto_value,
  }));
  await db.from("audit_metric_snapshots").upsert(snapshotRows, { onConflict: "daily_report_id,metric_key" });

  await logActivity({
    actorId: actor.id,
    action: existing ? "report.regenerated" : "report.generated",
    entityType: "audit_report",
    entityId: date,
    newValues: { metrics: auto },
  });
}

/** Save (or clear) a logged override for one metric. Empty value clears it. */
export async function saveMetricOverride(input: {
  date: string;
  metricKey: string;
  value: number | null;
  reason: string;
}): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "reports.generate");
  const db = supabaseAdmin();

  const { data: report } = await db
    .from("audit_daily_reports")
    .select("id,status,override_metric_snapshot")
    .eq("report_date", input.date)
    .maybeSingle();
  if (!report) throw new AuditorError("Generate the report before overriding a value.");
  if (report.status === "submitted" || report.status === "approved") {
    throw new AuditorError("This report is finalized. Reopen it before editing.");
  }

  const overrideSnapshot = { ...((report.override_metric_snapshot ?? {}) as Record<string, number>) };
  const { data: before } = await db
    .from("audit_metric_overrides")
    .select("override_value,reason")
    .eq("daily_report_id", report.id as string)
    .eq("metric_key", input.metricKey)
    .maybeSingle();

  if (input.value === null) {
    await db
      .from("audit_metric_overrides")
      .delete()
      .eq("daily_report_id", report.id as string)
      .eq("metric_key", input.metricKey);
    delete overrideSnapshot[input.metricKey];
  } else {
    if (!input.reason.trim()) throw new AuditorError("An override reason is required.");
    await db.from("audit_metric_overrides").upsert(
      {
        daily_report_id: report.id as string,
        metric_key: input.metricKey,
        override_value: input.value,
        reason: input.reason.trim(),
        created_by: actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "daily_report_id,metric_key" },
    );
    overrideSnapshot[input.metricKey] = input.value;
  }

  await db
    .from("audit_daily_reports")
    .update({ override_metric_snapshot: overrideSnapshot, updated_at: new Date().toISOString() })
    .eq("id", report.id as string);

  await logActivity({
    actorId: actor.id,
    action: input.value === null ? "report.override_cleared" : "report.override_set",
    entityType: "audit_report_metric",
    entityId: `${input.date}:${input.metricKey}`,
    oldValues: before ? { value: Number(before.override_value), reason: before.reason } : {},
    newValues: input.value === null ? {} : { value: input.value, reason: input.reason.trim() },
    metadata: { report_date: input.date, metric_key: input.metricKey },
  });
}

/** Finalize the report (submit). Also publishes a Reports-list summary row. */
export async function finalizeAuditReport(date: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "reports.generate");
  const db = supabaseAdmin();

  const detail = await getAuditReportDetail(date);
  if (!detail) throw new AuditorError("Generate the report before finalizing.");
  if (detail.status === "submitted" || detail.status === "approved") return;

  const { data: report } = await db
    .from("audit_daily_reports")
    .select("id")
    .eq("report_date", date)
    .maybeSingle();
  if (!report) throw new AuditorError("Report not found.");

  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("audit_daily_reports")
    .update({ status: "submitted", submitted_by: actor.id, submitted_at: nowIso, updated_at: nowIso })
    .eq("id", report.id as string);
  if (error) throw new AuditorError(error.message);

  // Publish a persistent narrative into the Reports list so finalized work does
  // not disappear after refresh (§B).
  const m = detail.metrics;
  const line = (key: string, label: string, value: string | number) =>
    `${label}: ${value}${detail.overrides[key] ? ` [OVERRIDDEN — ${detail.overrides[key].reason}]` : ""}`;
  const text = [
    `Auditor daily report — ${date}`,
    ``,
    line("total_leads", "Total leads", m.total_leads ?? 0),
    line("qualified_leads", "Qualified", `${m.qualified_leads ?? 0} (${m.qualification_percent ?? 0}%)`),
    line("booked_leads", "Booked", `${m.booked_leads ?? 0} (${m.booking_percent ?? 0}%)`),
    line("dropped_leads", "Dropped/Lost", `${m.dropped_leads ?? 0} (${m.drop_off_percent ?? 0}%)`),
    line("escalations_sent", "Escalations", m.escalations_sent ?? 0),
    line("total_payment_egp", "Total payments (EGP)", m.total_payment_egp ?? 0),
    line("cpl", "CPL", `${m.cpl ?? 0} (target ${m.target_cpl ?? 0})`),
    line("cost_per_booking", "Cost per booking", m.cost_per_booking ?? 0),
  ].join("\n");

  const published = {
      daily_report_id: report.id as string,
      report_type: "auditor_clinic_daily_ar",
      report_date: date,
      generated_text: text,
      generated_by: actor.id,
      status: "final",
      updated_at: nowIso,
    };
  // `daily_report_id` was not unique in early production versions of the
  // reporting schema. Avoid Postgres' "no unique constraint" upsert failure so
  // Finalize works before and after the corrective migration is applied.
  const { data: existingSummary } = await db
    .from("operational_summary_reports")
    .select("id")
    .eq("daily_report_id", report.id as string)
    .eq("report_type", "auditor_clinic_daily_ar")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const publishResult = existingSummary
    ? await db.from("operational_summary_reports").update(published).eq("id", existingSummary.id as string)
    : await db.from("operational_summary_reports").insert(published);
  if (publishResult.error) throw new AuditorError(publishResult.error.message);

  await logActivity({
    actorId: actor.id,
    action: "report.finalized",
    entityType: "audit_report",
    entityId: date,
    newValues: { status: "submitted", metrics: m },
  });
}

/** Reopen a finalized report for further editing. */
export async function reopenAuditReport(date: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "reports.generate");
  const db = supabaseAdmin();
  const { data: report } = await db
    .from("audit_daily_reports")
    .select("id,status")
    .eq("report_date", date)
    .maybeSingle();
  if (!report) throw new AuditorError("Report not found.");
  const { error } = await db
    .from("audit_daily_reports")
    .update({ status: "reopened", updated_at: new Date().toISOString() })
    .eq("id", report.id as string);
  if (error) throw new AuditorError(error.message);
  await logActivity({
    actorId: actor.id,
    action: "report.reopened",
    entityType: "audit_report",
    entityId: date,
    oldValues: { status: report.status },
    newValues: { status: "reopened" },
  });
}

export interface DroppedLead {
  leadId: string;
  name: string;
  lostReason: string | null;
  lostNotes: string | null;
}

/** Leads created on `date` currently marked Lost, with their mandatory reason. */
export async function droppedLeadsForDate(date: string, scope?: AuditorScope): Promise<DroppedLead[]> {
  const db = supabaseAdmin();
  const { start, end } = dayBounds(date);
  let q = db
    .from("leads")
    .select("lead_id,name,lost_notes,lost_reason_id,lost_reasons(label)")
    .is("deleted_at", null)
    .eq("status", "lost")
    .gte("created_at", start)
    .lt("created_at", end);
  if (scope?.doctorIds && scope.doctorIds.length > 0) q = q.in("doctor_id", scope.doctorIds);
  const { data, error } = await q;
  if (error) throw new AuditorError(error.message);
  return (data ?? []).map((r) => {
    const reasonJoin = r.lost_reasons as { label?: string } | { label?: string }[] | null;
    const label = Array.isArray(reasonJoin) ? reasonJoin[0]?.label : reasonJoin?.label;
    return {
      leadId: (r.lead_id as string) ?? "",
      name: (r.name as string) || "Lead",
      lostReason: label ?? null,
      lostNotes: (r.lost_notes as string) ?? null,
    };
  });
}

export interface AuditorFilterOptions {
  doctors: Array<{ id: string; name: string; specialtyId: string }>;
  specialties: Array<{ id: string; name: string }>;
}

/** Doctor + specialty options for the auditor scope filter, from the booking
 *  catalog (the single source of truth for doctors/specialties). */
export async function auditorFilterOptions(): Promise<AuditorFilterOptions> {
  try {
    const catalog = await bookingCatalog();
    return {
      doctors: catalog.doctors.map((d) => ({ id: d.id, name: d.nameEn, specialtyId: d.specialtyId })),
      specialties: catalog.specialties.map((s) => ({ id: s.id, name: s.nameEn })),
    };
  } catch {
    return { doctors: [], specialties: [] };
  }
}

/**
 * Resolve a chosen doctor and/or specialty into the concrete set of
 * `leads.doctor_id` values to scope by. Specialty expands to every doctor in
 * that specialty. Returns null when nothing is selected (clinic-wide view).
 */
export async function resolveAuditorScope(input: {
  doctorId?: string;
  specialtyId?: string;
}): Promise<AuditorScope | null> {
  if (!input.doctorId && !input.specialtyId) return null;
  const { doctors } = await auditorFilterOptions();
  let ids: string[] = [];
  if (input.doctorId) {
    ids = [input.doctorId];
  } else if (input.specialtyId) {
    ids = doctors.filter((d) => d.specialtyId === input.specialtyId).map((d) => d.id);
  }
  return { doctorIds: ids };
}

/** Live, non-persisted scoped snapshot for the dashboard's filtered view. */
export async function scopedSnapshotPreview(
  date: string,
  scope: AuditorScope,
): Promise<{ metrics: AuditorMetrics; redFlags: Array<{ key: string; reason: string }> }> {
  const metrics = await computeAutoSnapshot(date, scope);
  return { metrics, redFlags: auditorRedFlags(metrics) };
}

export interface AuditorTrendPoint {
  date: string;
  totalLeads: number;
  qualified: number;
  booked: number;
  dropped: number;
}

/** Seven-day live activity trend ending on the selected report day. */
export async function auditorTrend(
  endDate: string,
  scope?: AuditorScope,
): Promise<AuditorTrendPoint[]> {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const dates = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (6 - index));
    return isoDay(day);
  });
  const afterEnd = new Date(end);
  afterEnd.setUTCDate(afterEnd.getUTCDate() + 1);
  let query = supabaseAdmin()
    .from("leads")
    .select("created_at,status")
    .is("deleted_at", null)
    .gte("created_at", `${dates[0]}T00:00:00.000Z`)
    .lt("created_at", afterEnd.toISOString());
  if (scope?.doctorIds?.length) query = query.in("doctor_id", scope.doctorIds);
  const { data, error } = await query;
  if (error) throw new AuditorError(`auditorTrend: ${error.message}`);
  const points = new Map(dates.map((date) => [date, {
    date,
    totalLeads: 0,
    qualified: 0,
    booked: 0,
    dropped: 0,
  }]));
  for (const row of data ?? []) {
    const point = points.get(String(row.created_at).slice(0, 10));
    if (!point) continue;
    point.totalLeads += 1;
    if (row.status === "qualified") point.qualified += 1;
    if (row.status === "booked") point.booked += 1;
    if (row.status === "lost") point.dropped += 1;
  }
  return dates.map((date) => points.get(date)!);
}
