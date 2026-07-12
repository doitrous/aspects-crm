import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { getReservations } from "@/lib/booking/reservations";
import { bookingConfigured } from "@/lib/booking/client";

export const REPORT_TYPES = ["moderator_daily_ar", "follow_up_daily_ar", "auditor_clinic_daily_ar", "financial_daily", "marketing_daily"] as const;
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
  marketingPlatforms: MarketingPlatformPerformance[];
  bookingConnected: boolean;
}

export interface MarketingPlatformPerformance {
  key: string;
  label: string;
  leads: number;
  booked: number;
  attended: number;
  procedureReservations: number;
  revenue: number;
  bookingRate: number;
  attendanceRate: number;
  revenuePerLead: number;
}

function platformMeta(value: unknown): { key: string; label: string } {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "facebook" || raw === "facebook_messenger" || raw === "messenger") return { key: "facebook", label: "Facebook / Messenger" };
  if (raw === "instagram") return { key: "instagram", label: "Instagram" };
  if (raw === "whatsapp") return { key: "whatsapp", label: "WhatsApp" };
  if (raw === "web" || raw === "website" || raw === "website_booking") return { key: "web", label: "Website" };
  if (raw === "referral") return { key: "referral", label: "Referral" };
  if (raw === "walk_in") return { key: "walk_in", label: "Walk-in" };
  if (raw === "phone") return { key: "phone", label: "Phone" };
  return { key: "unattributed", label: "Unattributed" };
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
  const txP = db.from("crm_financial_transactions").select("lead_id,amount,kind,status").eq("occurred_on", date);
  const costsP = db.from("crm_external_costs").select("amount").eq("occurred_on", date);
  const incomingP = db.from("leads").select("id,platform").gte("created_at", start).lt("created_at", end);
  const reservationsP = getReservations({ from: date, to: date }).catch(() => []);
  const [totalLeads, qualified, booked, lostRows, escalations, followupsDue, followupsDone, postOpDue, postOpDone, overdue, tx, costs, incoming, reservations] = await Promise.all([
    leadCount(), leadCount("qualified"), leadCount("booked"), lostP, escalationP, followCount(null, false), followCount("completed", false), followCount(null, true), followCount("completed", true), overdueP, txP, costsP, incomingP, reservationsP,
  ]);
  let payments = 0;
  let refunds = 0;
  for (const row of tx.data ?? []) {
    if (row.status && row.status !== "completed") continue;
    const amount = Number(row.amount) || 0;
    if (row.kind === "payment") payments += amount;
    else refunds += amount;
  }
  const appointmentIds = reservations.map((row) => row.id);
  const { data: links } = appointmentIds.length
    ? await db.from("crm_lead_booking_links").select("appointment_id,lead_id").in("appointment_id", appointmentIds)
    : { data: [] as Array<{ appointment_id: string; lead_id: string }> };
  const linkedLeadIds = (links ?? []).map((row) => String(row.lead_id));
  const transactionLeadIds = (tx.data ?? []).map((row) => String(row.lead_id ?? "")).filter(Boolean);
  const lookupIds = [...new Set([...linkedLeadIds, ...transactionLeadIds])];
  const { data: attributedLeads } = lookupIds.length
    ? await db.from("leads").select("id,platform").in("id", lookupIds)
    : { data: [] as Array<{ id: string; platform: string | null }> };
  const platformByLead = new Map<string, ReturnType<typeof platformMeta>>();
  for (const row of [...(incoming.data ?? []), ...(attributedLeads ?? [])]) platformByLead.set(String(row.id), platformMeta(row.platform));
  const leadByAppointment = new Map((links ?? []).map((row) => [String(row.appointment_id), String(row.lead_id)]));
  const buckets = new Map<string, MarketingPlatformPerformance>();
  const bucket = (meta: ReturnType<typeof platformMeta>) => {
    if (!buckets.has(meta.key)) buckets.set(meta.key, { key: meta.key, label: meta.label, leads: 0, booked: 0, attended: 0, procedureReservations: 0, revenue: 0, bookingRate: 0, attendanceRate: 0, revenuePerLead: 0 });
    return buckets.get(meta.key)!;
  };
  for (const row of incoming.data ?? []) bucket(platformMeta(row.platform)).leads += 1;
  for (const reservation of reservations) {
    const leadId = leadByAppointment.get(reservation.id);
    const b = bucket((leadId && platformByLead.get(leadId)) || platformMeta(null));
    if (["reserved", "confirmed", "attended"].includes(reservation.status)) b.booked += 1;
    if (reservation.status === "attended") b.attended += 1;
    if (reservation.serviceId && ["reserved", "confirmed", "attended"].includes(reservation.status)) b.procedureReservations += 1;
  }
  for (const row of tx.data ?? []) {
    if (row.status && row.status !== "completed") continue;
    const b = bucket(platformByLead.get(String(row.lead_id)) || platformMeta(null));
    const amount = Number(row.amount) || 0;
    if (row.kind === "payment") b.revenue += amount;
    else if (["refund", "reversal", "chargeback"].includes(String(row.kind))) b.revenue -= amount;
  }
  const marketingPlatforms = [...buckets.values()].map((row) => ({ ...row,
    revenue: Math.round(row.revenue * 100) / 100,
    bookingRate: row.leads ? Math.round((row.booked / row.leads) * 1000) / 10 : 0,
    attendanceRate: row.booked ? Math.round((row.attended / row.booked) * 1000) / 10 : 0,
    revenuePerLead: row.leads ? Math.round((row.revenue / row.leads) * 100) / 100 : 0,
  })).sort((a, b) => b.revenue - a.revenue || b.booked - a.booked || b.leads - a.leads);
  return {
    date, totalLeads, contacted: qualified + booked + (lostRows.data?.length ?? 0), invalid: 0,
    qualified, booked, escalations: escalations.count ?? 0, unanswered: Math.max(0, totalLeads - qualified - booked - (lostRows.data?.length ?? 0)),
    lost: (lostRows.data ?? []).map((row) => {
      const join = row.lost_reasons as { label?: string } | { label?: string }[] | null;
      return { id: String(row.lead_id ?? ""), name: String(row.name ?? "Lead"), reason: (Array.isArray(join) ? join[0]?.label : join?.label) ?? String(row.lost_notes ?? "No reason recorded") };
    }),
    followupsDue, followupsDone, followupsOverdue: overdue.count ?? 0, postOpDue, postOpDone,
    payments, refunds, expenses: (costs.data ?? []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0), marketingPlatforms,
    bookingConnected: bookingConfigured(),
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
