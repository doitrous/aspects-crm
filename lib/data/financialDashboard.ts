import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { addMoney, roundMoney, subMoney } from "@/lib/financial/money";
import { computeProfitability, type ProfitabilitySummary } from "@/lib/financial/portfolio";
import { bookingCatalog } from "@/lib/booking/service";
import { leadSourcesList } from "@/lib/data";

export { computeProfitability } from "@/lib/financial/portfolio";
export type { ProfitabilityInput, ProfitabilitySummary } from "@/lib/financial/portfolio";

/**
 * Aggregate financial reporting over the CANONICAL financial tables — the same
 * source of truth the lead Payments tab reads. Nothing here keeps a second
 * dataset: it sums `crm_lead_financials` + its child tables and the
 * `crm_financial_transactions` ledger, using the shared money helpers so the
 * arithmetic matches the per-lead engine (`lib/financial/engine.ts`).
 *
 * Two date bases, per spec §28/§29 and labelled as such in the UI:
 *   - Profitability  → service/procedure date (`crm_lead_financials.service_date`)
 *   - Cash flow      → actual transaction date (`crm_financial_transactions.occurred_on`)
 */

export interface DateRange {
  /** inclusive YYYY-MM-DD */
  from: string;
  /** inclusive YYYY-MM-DD */
  to: string;
}

/* ── DB-backed readers ────────────────────────────────────────── */

interface FinRecord {
  id: string;
  base_service_price: number;
  quoted_price: number | null;
  service_name: string | null;
  is_exceptional: boolean;
  lead_id: string;
  leads: { doctor_id: string | null; source_id: string | null } | { doctor_id: string | null; source_id: string | null }[] | null;
}

function leadDim(rec: FinRecord): { doctorId: string | null; sourceId: string | null } {
  const l = rec.leads;
  const row = Array.isArray(l) ? l[0] : l;
  return { doctorId: row?.doctor_id ?? null, sourceId: row?.source_id ?? null };
}

async function sumChild(table: string, column: string, finIds: string[]): Promise<number> {
  if (finIds.length === 0) return 0;
  const { data, error } = await supabaseAdmin()
    .from(table)
    .select(column)
    .in("lead_financials_id", finIds);
  if (error) throw new Error(`sumChild(${table}): ${error.message}`);
  return addMoney(...(data ?? []).map((r) => Number((r as unknown as Record<string, unknown>)[column]) || 0));
}

/** Records whose service/procedure date falls in range (profitability basis). */
async function recordsInServiceRange(range: DateRange): Promise<FinRecord[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_lead_financials")
    .select("id,base_service_price,quoted_price,service_name,is_exceptional,lead_id,leads(doctor_id,source_id)")
    .gte("service_date", range.from)
    .lte("service_date", range.to);
  if (error) throw new Error(`recordsInServiceRange: ${error.message}`);
  return (data ?? []) as unknown as FinRecord[];
}

export interface RevenueBreakdownRow {
  key: string;
  label: string;
  recognizedRevenue: number;
  recordCount: number;
}

export interface FinancialDashboardData {
  range: DateRange;
  profitability: ProfitabilitySummary;
  cashFlow: CashFlowSummary;
  byDoctor: RevenueBreakdownRow[];
  byService: RevenueBreakdownRow[];
  bySource: RevenueBreakdownRow[];
  exceptionalCount: number;
  pendingApprovals: number;
  outstandingCurrent: number;
}

export interface CashFlowSummary {
  collected: number;
  refunds: number;
  reversals: number;
  chargebacks: number;
  doctorFunded: number;
  netCash: number;
  byMethod: Array<{ method: string; amount: number }>;
  byDay: Array<{ day: string; amount: number }>;
}

/** Cash-flow aggregation from the ledger, on the actual transaction date. */
export async function cashFlowSummary(range: DateRange): Promise<CashFlowSummary> {
  const { data, error } = await supabaseAdmin()
    .from("crm_financial_transactions")
    .select("amount,kind,method,occurred_on")
    .gte("occurred_on", range.from)
    .lte("occurred_on", range.to);
  if (error) throw new Error(`cashFlowSummary: ${error.message}`);
  const rows = (data ?? []) as Array<{ amount: number; kind: string; method: string | null; occurred_on: string }>;

  let collected = 0, refunds = 0, reversals = 0, chargebacks = 0, doctorFunded = 0;
  const method = new Map<string, number>();
  const day = new Map<string, number>();
  for (const r of rows) {
    const a = Number(r.amount) || 0;
    switch (r.kind) {
      case "payment": collected = addMoney(collected, a); break;
      case "refund": refunds = addMoney(refunds, a); break;
      case "reversal": reversals = addMoney(reversals, a); break;
      case "chargeback": chargebacks = addMoney(chargebacks, a); break;
      case "doctor_funded": doctorFunded = addMoney(doctorFunded, a); break;
    }
    if (r.kind === "payment") {
      const m = r.method ?? "other";
      method.set(m, addMoney(method.get(m) ?? 0, a));
      day.set(r.occurred_on, addMoney(day.get(r.occurred_on) ?? 0, a));
    }
  }
  const netCash = roundMoney(collected - refunds - reversals - chargebacks);
  return {
    collected: roundMoney(collected),
    refunds: roundMoney(refunds),
    reversals: roundMoney(reversals),
    chargebacks: roundMoney(chargebacks),
    doctorFunded: roundMoney(doctorFunded),
    netCash,
    byMethod: [...method.entries()].map(([m, amount]) => ({ method: m, amount })).sort((a, b) => b.amount - a.amount),
    byDay: [...day.entries()].map(([d, amount]) => ({ day: d, amount })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

/** Current portfolio outstanding across ALL leads: recognized − net collected. */
async function outstandingCurrent(): Promise<number> {
  const db = supabaseAdmin();
  const [{ data: fin }, { data: txns }] = await Promise.all([
    db.from("crm_lead_financials").select("quoted_price"),
    db.from("crm_financial_transactions").select("amount,kind"),
  ]);
  const recognized = addMoney(...(fin ?? []).map((r) => Number(r.quoted_price) || 0));
  let net = 0;
  for (const t of txns ?? []) {
    const a = Number(t.amount) || 0;
    if (t.kind === "payment" || t.kind === "doctor_funded") net = addMoney(net, a);
    else if (t.kind === "refund" || t.kind === "reversal" || t.kind === "chargeback") net = subMoney(net, a);
  }
  return roundMoney(Math.max(0, subMoney(recognized, net)));
}

/** The whole Financial Dashboard payload for a date range. */
export async function financialDashboard(range: DateRange): Promise<FinancialDashboardData> {
  const records = await recordsInServiceRange(range);
  const finIds = records.map((r) => r.id);

  const [consumablesTotal, doctorCompensationTotal, externalCostsTotal, cashFlow, outstanding, sources, catalog] =
    await Promise.all([
      sumChild("crm_lead_consumables", "total_cost", finIds),
      sumChild("crm_lead_doctor_compensation", "computed_amount", finIds),
      sumChild("crm_external_costs", "amount", finIds),
      cashFlowSummary(range),
      outstandingCurrent(),
      leadSourcesList().catch(() => []),
      bookingCatalog().catch(() => ({ doctors: [] as Array<{ id: string; nameEn: string }> })),
    ]);

  const profitability = computeProfitability({
    baseServicePrices: records.map((r) => Number(r.base_service_price) || 0),
    quotedPrices: records.map((r) => Number(r.quoted_price) || 0),
    consumablesTotal,
    doctorCompensationTotal,
    externalCostsTotal,
  });

  // Breakdowns (recognized revenue = quoted), on the service-date basis.
  const doctorName = new Map((catalog.doctors ?? []).map((d) => [d.id, d.nameEn] as const));
  const sourceName = new Map(sources.map((s) => [s.id, s.label] as const));
  const byDoctor = groupBreakdown(records, (r) => {
    const { doctorId } = leadDim(r);
    return doctorId ? { key: doctorId, label: doctorName.get(doctorId) ?? "Unknown doctor" } : { key: "none", label: "Unassigned" };
  });
  const byService = groupBreakdown(records, (r) => ({ key: r.service_name ?? "none", label: r.service_name ?? "Unspecified" }));
  const bySource = groupBreakdown(records, (r) => {
    const { sourceId } = leadDim(r);
    return sourceId ? { key: sourceId, label: sourceName.get(sourceId) ?? "Unknown source" } : { key: "none", label: "Direct / unknown" };
  });

  const exceptionalCount = records.filter((r) => r.is_exceptional).length;
  const { count: pendingApprovals } = await supabaseAdmin()
    .from("crm_discount_approvals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  return {
    range,
    profitability,
    cashFlow,
    byDoctor,
    byService,
    bySource,
    exceptionalCount,
    pendingApprovals: pendingApprovals ?? 0,
    outstandingCurrent: outstanding,
  };
}

function groupBreakdown(
  records: FinRecord[],
  keyer: (r: FinRecord) => { key: string; label: string },
): RevenueBreakdownRow[] {
  const acc = new Map<string, { label: string; revenue: number; count: number }>();
  for (const r of records) {
    const { key, label } = keyer(r);
    const cur = acc.get(key) ?? { label, revenue: 0, count: 0 };
    cur.revenue = addMoney(cur.revenue, Number(r.quoted_price) || 0);
    cur.count += 1;
    acc.set(key, cur);
  }
  return [...acc.entries()]
    .map(([key, v]) => ({ key, label: v.label, recognizedRevenue: roundMoney(v.revenue), recordCount: v.count }))
    .sort((a, b) => b.recognizedRevenue - a.recognizedRevenue);
}

/* ── Exceptional pricing cases (drill-down) ───────────────────── */

export interface ExceptionalCase {
  id: string;
  leadHumanId: string | null;
  leadUid: string | null;
  serviceName: string | null;
  basePrice: number;
  requestedQuotedPrice: number;
  requestedPct: number;
  maxAllowedPct: number;
  approvedQuotedPrice: number | null;
  status: string;
  reason: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  createdAt: string;
}

export async function exceptionalCases(status?: string): Promise<ExceptionalCase[]> {
  const db = supabaseAdmin();
  let q = db
    .from("crm_discount_approvals")
    .select("id,lead_id,base_service_price,requested_quoted_price,requested_pct,max_allowed_pct,approved_quoted_price,status,reason,requested_by,decided_by,created_at,leads(lead_id)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (status && status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(`exceptionalCases: ${error.message}`);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const actorIds = [
    ...new Set(rows.flatMap((r) => [r.requested_by, r.decided_by]).filter((v): v is string => !!v)),
  ];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: users } = await db.from("crm_users").select("id,full_name,email").in("id", actorIds);
    for (const u of users ?? []) names.set(u.id as string, (u.full_name as string) || (u.email as string) || "—");
  }

  return rows.map((r) => {
    const leadJoin = r.leads as { lead_id?: string } | { lead_id?: string }[] | null;
    const leadHumanId = Array.isArray(leadJoin) ? leadJoin[0]?.lead_id : leadJoin?.lead_id;
    return {
      id: r.id as string,
      leadHumanId: leadHumanId ?? null,
      leadUid: (r.lead_id as string) ?? null,
      serviceName: null,
      basePrice: Number(r.base_service_price) || 0,
      requestedQuotedPrice: Number(r.requested_quoted_price) || 0,
      requestedPct: Number(r.requested_pct) || 0,
      maxAllowedPct: Number(r.max_allowed_pct) || 0,
      approvedQuotedPrice: r.approved_quoted_price != null ? Number(r.approved_quoted_price) : null,
      status: (r.status as string) ?? "pending",
      reason: (r.reason as string) ?? null,
      requestedByName: r.requested_by ? (names.get(r.requested_by as string) ?? "—") : null,
      decidedByName: r.decided_by ? (names.get(r.decided_by as string) ?? "—") : null,
      createdAt: r.created_at as string,
    };
  });
}
