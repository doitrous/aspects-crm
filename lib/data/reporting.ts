import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";

export const REPORT_TYPES = ["moderator_daily_ar", "follow_up_daily_ar", "auditor_clinic_daily_ar", "financial_daily"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export interface ReportAutoData {
  date: string;
  totalLeads: number;
  contacted: number;
  invalid: number;
  qualified: number;
  booked: number;
  escalations: number;
  unanswered: number;
  lost: Array<{ id: string; name: string; reason: string }>;
  followupsDue: number;
  followupsDone: number;
  followupsOverdue: number;
  postOpDue: number;
  postOpDone: number;
  payments: number;
  refunds: number;
  expenses: number;
}

function bounds(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function reportAutoData(date: string): Promise<ReportAutoData> {
  const db = supabaseAdmin();
  const { start, end } = bounds(date);
  const leadCount = async (status?: string) => {
    let q = db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end);
    if (status) q = q.eq("status", status);
    return (await q).count ?? 0;
  };
  const followCount = async (status: string | null, postOp: boolean) => {
    let q = db.from("lead_follow_up_stages").select("id", { count: "exact", head: true }).gte("due_at", start).lt("due_at", end);
    q = postOp ? q.eq("workflow_type", "post_op") : q.neq("workflow_type", "post_op");
    if (status) q = q.eq("status", status);
    return (await q).count ?? 0;
  };
  const overdueP = db.from("lead_follow_up_stages").select("id", { count: "exact", head: true }).lt("due_at", start).in("status", ["pending", "overdue"]);
  const lostP = db.from("leads").select("lead_id,name,lost_notes,lost_reasons(label)").eq("status", "lost").gte("updated_at", start).lt("updated_at", end);
  const escalationP = db.from("escalations").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end);
  const txP = db.from("crm_financial_transactions").select("amount,kind").eq("occurred_on", date);
  const costsP = db.from("crm_external_costs").select("amount").eq("occurred_on", date);
  const [totalLeads, qualified, booked, lostRows, escalations, followupsDue, followupsDone, postOpDue, postOpDone, overdue, tx, costs] = await Promise.all([
    leadCount(), leadCount("qualified"), leadCount("booked"), lostP, escalationP, followCount(null, false), followCount("completed", false), followCount(null, true), followCount("completed", true), overdueP, txP, costsP,
  ]);
  let payments = 0;
  let refunds = 0;
  for (const row of tx.data ?? []) {
    const amount = Number(row.amount) || 0;
    if (row.kind === "payment") payments += amount;
    else refunds += amount;
  }
  return {
    date, totalLeads, contacted: qualified + booked + (lostRows.data?.length ?? 0), invalid: 0,
    qualified, booked, escalations: escalations.count ?? 0, unanswered: Math.max(0, totalLeads - qualified - booked - (lostRows.data?.length ?? 0)),
    lost: (lostRows.data ?? []).map((row) => {
      const join = row.lost_reasons as { label?: string } | { label?: string }[] | null;
      return { id: String(row.lead_id ?? ""), name: String(row.name ?? "Lead"), reason: (Array.isArray(join) ? join[0]?.label : join?.label) ?? String(row.lost_notes ?? "No reason recorded") };
    }),
    followupsDue, followupsDone, followupsOverdue: overdue.count ?? 0, postOpDue, postOpDone,
    payments, refunds, expenses: (costs.data ?? []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
  };
}

export interface ModeratorScorecard {
  id: string;
  name: string;
  scores: { languageTone: number; accuracy: number; callToAction: number; dataCollection: number; processCompliance: number } | null;
  average: number | null;
  previousAverage: number | null;
}

export async function moderatorScorecards(date: string): Promise<ModeratorScorecard[]> {
  const db = supabaseAdmin();
  const { data: users } = await db.from("crm_users").select("id,full_name,email").eq("role", "moderator").eq("is_active", true).order("full_name");
  const { data: report } = await db.from("audit_daily_reports").select("id").eq("report_date", date).maybeSingle();
  const ids = (users ?? []).map((u) => `moderator:${u.id}`);
  const { data: current } = report && ids.length ? await db.from("audit_manual_scores").select("score_type,language_tone,accuracy,call_to_action,data_collection,process_compliance,total_score").eq("daily_report_id", report.id).in("score_type", ids) : { data: [] };
  const prevEnd = new Date(`${date}T00:00:00Z`);
  const prevStart = new Date(prevEnd); prevStart.setUTCDate(prevStart.getUTCDate() - 30);
  const { data: history } = ids.length ? await db.from("audit_manual_scores").select("score_type,total_score,audit_daily_reports!inner(report_date)").in("score_type", ids).gte("audit_daily_reports.report_date", prevStart.toISOString().slice(0, 10)).lt("audit_daily_reports.report_date", date) : { data: [] };
  return (users ?? []).map((u) => {
    const key = `moderator:${u.id}`;
    const row = current?.find((r) => r.score_type === key);
    const prior = (history ?? []).filter((r) => r.score_type === key).map((r) => Number(r.total_score));
    return {
      id: String(u.id), name: String(u.full_name || u.email || "Moderator"),
      scores: row ? { languageTone: Number(row.language_tone), accuracy: Number(row.accuracy), callToAction: Number(row.call_to_action), dataCollection: Number(row.data_collection), processCompliance: Number(row.process_compliance) } : null,
      average: row ? Number(row.total_score) : null,
      previousAverage: prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : null,
    };
  });
}
