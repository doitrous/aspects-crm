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
  service_date: string | null;
  leads: { doctor_id: string | null; source_id: string | null } | { doctor_id: string | null; source_id: string | null }[] | null;
}

function leadDim(rec: FinRecord): { doctorId: string | null; sourceId: string | null } {
  const l = rec.leads;
  const row = Array.isArray(l) ? l[0] : l;
  return { doctorId: row?.doctor_id ?? null, sourceId: row?.source_id ?? null };
}

async function childAmountsByFinancialId(table: string, column: string, finIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (finIds.length === 0) return totals;
  const { data, error } = await supabaseAdmin().from(table).select(`lead_financials_id,${column}`).in("lead_financials_id", finIds);
  if (error) throw new Error(`childAmountsByFinancialId(${table}): ${error.message}`);
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const id = String(row.lead_financials_id);
    totals.set(id, addMoney(totals.get(id) ?? 0, Number(row[column]) || 0));
  }
  return totals;
}

/** Records whose service/procedure date falls in range (profitability basis). */
async function recordsInServiceRange(range: DateRange): Promise<FinRecord[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_lead_financials")
    .select("id,base_service_price,quoted_price,service_name,is_exceptional,lead_id,service_date,leads(doctor_id,source_id)")
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
  profitByDay: Array<{ day: string; revenue: number; costs: number; profit: number }>;
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
  const db = supabaseAdmin();
  const [{ data, error }, { data: funded, error: fundedError }] = await Promise.all([
    db
    .from("crm_financial_transactions")
      .select("amount,kind,method,occurred_on,status")
    .gte("occurred_on", range.from)
      .lte("occurred_on", range.to)
      .eq("status", "completed"),
    db
      .from("crm_doctor_funded_payments")
      .select("amount,occurred_on")
      .gte("occurred_on", range.from)
      .lte("occurred_on", range.to),
  ]);
  if (error) throw new Error(`cashFlowSummary: ${error.message}`);
  if (fundedError) throw new Error(`cashFlowSummary(doctor-funded): ${fundedError.message}`);
  const rows = (data ?? []) as Array<{ amount: number; kind: string; method: string | null; occurred_on: string }>;

  let collected = 0, refunds = 0, reversals = 0, chargebacks = 0;
  const method = new Map<string, number>();
  const day = new Map<string, number>();
  for (const r of rows) {
    const a = Number(r.amount) || 0;
    switch (r.kind) {
      case "payment": collected = addMoney(collected, a); break;
      case "refund": refunds = addMoney(refunds, a); break;
      case "reversal": reversals = addMoney(reversals, a); break;
      case "chargeback": chargebacks = addMoney(chargebacks, a); break;
    }
    if (r.kind === "payment") {
      const m = r.method ?? "other";
      method.set(m, addMoney(method.get(m) ?? 0, a));
      day.set(r.occurred_on, addMoney(day.get(r.occurred_on) ?? 0, a));
    }
  }
  const doctorFunded = addMoney(...(funded ?? []).map((r) => Number(r.amount) || 0));
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
  const [{ data: fin }, { data: txns }, { data: funded }] = await Promise.all([
    db.from("crm_lead_financials").select("quoted_price"),
    db.from("crm_financial_transactions").select("amount,kind,status").eq("status", "completed"),
    db.from("crm_doctor_funded_payments").select("amount,reduces_patient_balance").eq("reduces_patient_balance", true),
  ]);
  const recognized = addMoney(...(fin ?? []).map((r) => Number(r.quoted_price) || 0));
  let net = 0;
  for (const t of txns ?? []) {
    const a = Number(t.amount) || 0;
    if (t.kind === "payment" || t.kind === "doctor_funded") net = addMoney(net, a);
    else if (t.kind === "refund" || t.kind === "reversal" || t.kind === "chargeback") net = subMoney(net, a);
  }
  net = addMoney(net, ...(funded ?? []).map((r) => Number(r.amount) || 0));
  return roundMoney(Math.max(0, subMoney(recognized, net)));
}

/** The whole Financial Dashboard payload for a date range. */
export async function financialDashboard(range: DateRange): Promise<FinancialDashboardData> {
  const records = await recordsInServiceRange(range);
  const finIds = records.map((r) => r.id);

  const [cashFlow, outstanding, sources, catalog, consumablesByFin, compensationByFin, externalByFin] =
    await Promise.all([
      cashFlowSummary(range),
      outstandingCurrent(),
      leadSourcesList().catch(() => []),
      bookingCatalog().catch(() => ({ doctors: [] as Array<{ id: string; nameEn: string }> })),
      childAmountsByFinancialId("crm_lead_consumables", "total_cost", finIds),
      childAmountsByFinancialId("crm_lead_doctor_compensation", "computed_amount", finIds),
      childAmountsByFinancialId("crm_external_costs", "amount", finIds),
    ]);

  const consumablesTotal = addMoney(...consumablesByFin.values());
  const doctorCompensationTotal = addMoney(...compensationByFin.values());
  const externalCostsTotal = addMoney(...externalByFin.values());

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
  const daily = new Map<string, { revenue: number; costs: number }>();
  for (const record of records) {
    const day = record.service_date ?? range.from;
    const current = daily.get(day) ?? { revenue: 0, costs: 0 };
    current.revenue = addMoney(current.revenue, Number(record.quoted_price) || 0);
    current.costs = addMoney(current.costs, consumablesByFin.get(record.id) ?? 0, compensationByFin.get(record.id) ?? 0, externalByFin.get(record.id) ?? 0);
    daily.set(day, current);
  }
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
    profitByDay: [...daily.entries()].map(([day, values]) => ({ day, revenue: roundMoney(values.revenue), costs: roundMoney(values.costs), profit: roundMoney(values.revenue - values.costs) })).sort((a, b) => a.day.localeCompare(b.day)),
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
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;

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

/* ── Metric drill-downs ──────────────────────────────────────── */

export type FinancialDrilldownType =
  | "outstanding"
  | "doctor_compensation"
  | "external_costs"
  | "refunds"
  | "reversals"
  | "chargebacks";

export interface FinancialDrilldownRow {
  id: string;
  leadHumanId: string | null;
  leadName: string | null;
  label: string;
  amount: number;
  date: string | null;
  meta: string | null;
}

interface LeadJoin {
  lead_id?: string | null;
  name?: string | null;
}

function oneLead(v: unknown): LeadJoin | null {
  if (!v) return null;
  return Array.isArray(v) ? ((v[0] as LeadJoin | undefined) ?? null) : (v as LeadJoin);
}

export async function financialDrilldown(
  type: FinancialDrilldownType,
  range: DateRange,
): Promise<FinancialDrilldownRow[]> {
  if (type === "outstanding") return outstandingRows();
  if (type === "doctor_compensation") return childRows("crm_lead_doctor_compensation", "computed_amount", "doctor");
  if (type === "external_costs") return childRows("crm_external_costs", "amount", "external");
  return transactionRows(type, range);
}

async function outstandingRows(): Promise<FinancialDrilldownRow[]> {
  const db = supabaseAdmin();
  const { data: records, error } = await db
    .from("crm_lead_financials")
    .select("id,service_name,quoted_price,leads(lead_id,name)")
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`outstandingRows(records): ${error.message}`);
  const finRows = (records ?? []) as Array<Record<string, unknown>>;
  const ids = finRows.map((r) => r.id as string);
  if (!ids.length) return [];

  const [{ data: txns, error: txError }, { data: funded, error: fundedError }] = await Promise.all([
    db
      .from("crm_financial_transactions")
      .select("lead_financials_id,amount,kind,status")
      .in("lead_financials_id", ids)
      .eq("status", "completed"),
    db
      .from("crm_doctor_funded_payments")
      .select("lead_financials_id,amount,reduces_patient_balance")
      .in("lead_financials_id", ids)
      .eq("reduces_patient_balance", true),
  ]);
  if (txError) throw new Error(`outstandingRows(transactions): ${txError.message}`);
  if (fundedError) throw new Error(`outstandingRows(doctor-funded): ${fundedError.message}`);

  const collected = new Map<string, number>();
  for (const t of txns ?? []) {
    const id = t.lead_financials_id as string;
    const amount = Number(t.amount) || 0;
    const kind = t.kind as string;
    const current = collected.get(id) ?? 0;
    collected.set(
      id,
      kind === "payment" || kind === "doctor_funded"
        ? addMoney(current, amount)
        : ["refund", "reversal", "chargeback"].includes(kind)
          ? subMoney(current, amount)
          : current,
    );
  }
  for (const f of funded ?? []) {
    const id = f.lead_financials_id as string;
    collected.set(id, addMoney(collected.get(id) ?? 0, Number(f.amount) || 0));
  }

  return finRows
    .map((r) => {
      const id = r.id as string;
      const lead = oneLead(r.leads);
      const quoted = Number(r.quoted_price) || 0;
      const outstanding = roundMoney(Math.max(0, subMoney(quoted, collected.get(id) ?? 0)));
      return {
        id,
        leadHumanId: lead?.lead_id ?? null,
        leadName: lead?.name ?? null,
        label: (r.service_name as string | null) ?? "Unspecified service",
        amount: outstanding,
        date: null,
        meta: `Quoted ${roundMoney(quoted).toLocaleString("en-US")} EGP`,
      };
    })
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 300);
}

async function recordMap(finIds: string[]): Promise<Map<string, { leadHumanId: string | null; leadName: string | null; serviceName: string | null }>> {
  const map = new Map<string, { leadHumanId: string | null; leadName: string | null; serviceName: string | null }>();
  if (!finIds.length) return map;
  const { data, error } = await supabaseAdmin()
    .from("crm_lead_financials")
    .select("id,service_name,leads(lead_id,name)")
    .in("id", finIds);
  if (error) throw new Error(`recordMap: ${error.message}`);
  for (const r of data ?? []) {
    const lead = oneLead((r as Record<string, unknown>).leads);
    map.set((r as Record<string, unknown>).id as string, {
      leadHumanId: lead?.lead_id ?? null,
      leadName: lead?.name ?? null,
      serviceName: ((r as Record<string, unknown>).service_name as string | null) ?? null,
    });
  }
  return map;
}

async function childRows(
  table: "crm_lead_doctor_compensation" | "crm_external_costs",
  amountColumn: "computed_amount" | "amount",
  kind: "doctor" | "external",
): Promise<FinancialDrilldownRow[]> {
  const select =
    kind === "doctor"
      ? "id,lead_financials_id,doctor_name,doctor_id,kind,value,basis,computed_amount,created_at"
      : "id,lead_financials_id,category,description,amount,vendor,occurred_on";
  const { data, error } = await supabaseAdmin()
    .from(table)
    .select(select)
    .order(kind === "doctor" ? "created_at" : "occurred_on", { ascending: false })
    .limit(300);
  if (error) throw new Error(`childRows(${table}): ${error.message}`);
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const records = await recordMap([...new Set(rows.map((r) => r.lead_financials_id as string))]);
  return rows.map((r) => {
    const rec = records.get(r.lead_financials_id as string);
    const doctorMeta = `${r.kind ?? ""} ${r.value ?? ""}${r.kind === "percentage" ? "%" : " EGP"} · ${r.basis ?? ""}`;
    const externalMeta = [r.category, r.vendor].filter(Boolean).join(" · ");
    return {
      id: r.id as string,
      leadHumanId: rec?.leadHumanId ?? null,
      leadName: rec?.leadName ?? null,
      label:
        kind === "doctor"
          ? ((r.doctor_name as string | null) ?? (r.doctor_id as string) ?? "Unknown doctor")
          : ((r.description as string | null) ?? "External cost"),
      amount: Number(r[amountColumn]) || 0,
      date: kind === "doctor" ? (r.created_at as string | null) : (r.occurred_on as string | null),
      meta: kind === "doctor" ? doctorMeta : externalMeta || rec?.serviceName || null,
    };
  });
}

async function transactionRows(type: "refunds" | "reversals" | "chargebacks", range: DateRange): Promise<FinancialDrilldownRow[]> {
  const kind = type === "refunds" ? "refund" : type === "reversals" ? "reversal" : "chargeback";
  const { data, error } = await supabaseAdmin()
    .from("crm_financial_transactions")
    .select("id,lead_id,amount,method,status,occurred_on,reference,receipt_number,note,leads(lead_id,name)")
    .eq("kind", kind)
    .gte("occurred_on", range.from)
    .lte("occurred_on", range.to)
    .order("occurred_on", { ascending: false })
    .limit(300);
  if (error) throw new Error(`transactionRows(${kind}): ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const lead = oneLead(r.leads);
    return {
      id: r.id as string,
      leadHumanId: lead?.lead_id ?? null,
      leadName: lead?.name ?? null,
      label: kind,
      amount: Number(r.amount) || 0,
      date: (r.occurred_on as string | null) ?? null,
      meta: [r.status, r.method, r.receipt_number ?? r.reference, r.note].filter(Boolean).join(" · ") || null,
    };
  });
}
