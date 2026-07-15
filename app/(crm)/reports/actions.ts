"use server";

import { revalidatePath } from "next/cache";
import { can } from "@/lib/auth/permissions";
import { writeActor } from "@/lib/data/actor";
import { generateAuditReport } from "@/lib/data/auditor";
import { REPORT_TYPES, reportAutoData, type ReportType } from "@/lib/data/reporting";
import { supabaseAdmin } from "@/lib/supabase/server";
import { requireSession } from "@/lib/data/session";

export interface ReportActionState { ok: boolean; message?: string; error?: string; reportId?: string }

export async function calculateReportAction(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Choose a valid report date." };
  try {
    const { effective } = await requireSession();
    if (!can(effective.role, "reports.view")) return { error: "You are not allowed to calculate reports." };
    return { data: await reportAutoData(date) };
  } catch (err) {
    console.error("report calculation failed", err);
    return { error: "Automatic calculation failed. The report page is still available; please retry or ask an admin to verify the reporting tables." };
  }
}

function allowed(role: "admin" | "auditor" | "moderator" | "viewer", type: ReportType) {
  return can(role, "reports.generate") || (can(role, "reports.createOwn") && (type === "moderator_daily_ar" || type === "follow_up_daily_ar"));
}

function text(fd: FormData, key: string, fallback = "لا يوجد") { return String(fd.get(key) ?? "").trim() || fallback; }

export async function createOperationalReportAction(_prev: ReportActionState, fd: FormData): Promise<ReportActionState> {
  try {
    const actor = await writeActor();
    const type = String(fd.get("reportType")) as ReportType;
    const date = String(fd.get("date") ?? "");
    if (!REPORT_TYPES.includes(type) || !allowed(actor.role, type)) return { ok: false, error: "You are not allowed to create this report type." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Choose a valid report date." };
    const d = await reportAutoData(date);
    const overrideReason = String(fd.get("overrideReason") ?? "").trim();
    const metric = (key: string, automatic: number) => {
      const raw = String(fd.get(`override_${key}`) ?? "").trim();
      if (!raw) return String(automatic);
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return String(automatic);
      return `${value} [OVERRIDDEN — ${overrideReason || "Manual correction"}; auto: ${automatic}]`;
    };
    const common = [`التاريخ: ${date}`];
    let body: string[];
    if (type === "moderator_daily_ar") body = [...common,
      `العملاء الجدد اليوم: ${metric("totalLeads",d.totalLeads)}`, `عملاء تم التواصل معهم: ${metric("contacted",d.contacted)}`, `أرقام خاطئة / غير صالحة: ${metric("invalid",d.invalid)}`,
      `عملاء مؤهلون (Qualified Leads): ${metric("qualified",d.qualified)}`, `- اجمالي عدد المؤهلون: ${metric("qualified",d.qualified)}`, `- تم متابعتهم اليوم: ${metric("followupsDone",d.followupsDone)}`, `- معلقين 4-7 ايام: ${text(fd,"pending47","0")}`, `- معلقين ٧+ ايام: ${text(fd,"pending7","0")}`,
      `تم الحجز / التأكيد: ${metric("booked",d.booked)}`, `عدد التصعيدات: ${metric("escalations",d.escalations)}`, `لم يردوا: ${metric("unanswered",d.unanswered)}`,
      `عملاء تم خسارتهم: ${d.lost.length}`, ...d.lost.map((l) => `- ${l.id} · ${l.name}: ${l.reason}`), "", `تحديثات هامة للعملاء:\n${text(fd,"importantUpdates")}`, `حالات تحتاج لتدخل الإدارة أو الطبيب:\n${text(fd,"intervention")}`, `حالات معلقة:\n${text(fd,"pendingCases")}`];
    else if (type === "follow_up_daily_ar") body = [...common, `عدد متابعات اليوم: ${metric("followupsDue",d.followupsDue)}`, `عدد المتابعات تم إنجازها: ${metric("followupsDone",d.followupsDone)}`, `عدد متابعات ما بعد العملية اليوم: ${metric("postOpDue",d.postOpDue)}`, `متابعات ما بعد العملية تم انجازها: ${metric("postOpDone",d.postOpDone)}`, `متابعات متأخرة/لم تكتمل: ${metric("followupsOverdue",d.followupsOverdue)} - ${text(fd,"overdueReasons")}`, `لا يوجد رد: ${metric("unanswered",d.unanswered)}`, `مهتمون أو تم الرد مرة أخرى: ${metric("qualified",d.qualified)}`, `تم الحجز / التأكيد: ${metric("booked",d.booked)}`, `غير مهتمين / تم الخسارة: ${d.lost.length}\n${d.lost.map((l) => `- ${l.id} · ${l.name}: ${l.reason}`).join("\n") || "لا يوجد"}`, "", `تحديثات هامة للمتابعات:\n${text(fd,"importantUpdates")}`, `حالات تحتاج لتدخل الإدارة أو الطبيب:\n${text(fd,"intervention")}`, `حالات معلقة:\n${text(fd,"pendingCases")}`];
    else if (type === "financial_daily") body = [...common, `إجمالي التحصيلات: ${d.payments.toLocaleString()} EGP`, `المردودات والتسويات: ${d.refunds.toLocaleString()} EGP`, `التكاليف الخارجية: ${d.expenses.toLocaleString()} EGP`, `صافي التدفق النقدي: ${(d.payments-d.refunds-d.expenses).toLocaleString()} EGP`, `الحجوزات: ${d.booked}`, `متوسط التحصيل لكل حجز: ${d.booked ? Math.round(d.payments/d.booked).toLocaleString() : 0} EGP`, "", `ملاحظات مالية:\n${text(fd,"importantUpdates")}`];
    else if (type === "marketing_daily") {
      const rows = d.marketingPlatforms;
      const total = rows.reduce((sum, row) => ({ leads: sum.leads + row.leads, booked: sum.booked + row.booked, attended: sum.attended + row.attended, procedures: sum.procedures + row.procedureReservations, revenue: sum.revenue + row.revenue }), { leads: 0, booked: 0, attended: 0, procedures: 0, revenue: 0 });
      const topLeads = [...rows].sort((a,b)=>b.leads-a.leads)[0];
      const topBookings = [...rows].sort((a,b)=>b.booked-a.booked)[0];
      const topRevenue = [...rows].sort((a,b)=>b.revenue-a.revenue)[0];
      body = [
        `Marketing Report — ${date}`, "", "EXECUTIVE SUMMARY",
        `Incoming leads: ${total.leads}`, `Booked appointments: ${total.booked}`, `Attendance: ${total.attended}`,
        `Procedure reservations: ${total.procedures}`, `Net collected revenue: ${total.revenue.toLocaleString()} EGP`, "",
        "PLATFORM PERFORMANCE",
        ...rows.flatMap((row, index) => [`${index + 1}. ${row.label}`, `   Leads: ${row.leads} | Booked: ${row.booked} | Attended: ${row.attended} | Procedure reservations: ${row.procedureReservations}`, `   Revenue: ${row.revenue.toLocaleString()} EGP | Booking rate: ${row.bookingRate}% | Attendance rate: ${row.attendanceRate}% | Revenue / lead: ${row.revenuePerLead.toLocaleString()} EGP`]), "",
        "COMPARISON & INSIGHTS",
        `Most incoming leads: ${topLeads ? `${topLeads.label} (${topLeads.leads})` : "No attributed data"}`,
        `Most bookings: ${topBookings ? `${topBookings.label} (${topBookings.booked})` : "No attributed data"}`,
        `Highest revenue: ${topRevenue ? `${topRevenue.label} (${topRevenue.revenue.toLocaleString()} EGP)` : "No attributed data"}`,
        `Unattributed leads: ${rows.find((row)=>row.key==="unattributed")?.leads ?? 0} — improve source tagging when this is above zero.`, "",
        "CALCULATION BASIS",
        "Leads use CRM creation date. Booked, attendance and procedure reservations use appointment date. Revenue is completed patient payments minus refunds/reversals/chargebacks on the report date. Appointments and payments are attributed through their linked CRM lead.", "",
        ...(!d.bookingConnected ? ["DATA QUALITY WARNING", "The booking integration is not connected. Booking, attendance and procedure-reservation figures are unavailable, not confirmed zero.", ""] : []),
        `Marketing notes:\n${text(fd,"importantUpdates")}`,
      ];
    }
    else body = [...common, `إجمالي العملاء: ${d.totalLeads}`, `المؤهلون: ${d.qualified}`, `الحجوزات: ${d.booked}`, `الحالات المفقودة: ${d.lost.length}`, `التصعيدات: ${d.escalations}`, `التحصيلات: ${d.payments.toLocaleString()} EGP`, "", `ملاحظات المدقق:\n${text(fd,"importantUpdates")}`, `قرار مطلوب من الإدارة:\n${text(fd,"intervention")}`];
    const { data, error } = await supabaseAdmin().from("operational_summary_reports").insert({ report_type: type, report_date: date, generated_text: body.join("\n"), generated_by: actor.id, status: "final" }).select("id").single();
    if (error) throw error;
    revalidatePath("/reports");
    return { ok: true, message: "Report submitted. Automatically calculated values are locked into this copy.", reportId: String(data.id) };
  } catch (err) {
    console.error("create operational report failed", err);
    return { ok: false, error: "The report could not be submitted. Please try again." };
  }
}

export async function saveModeratorScoreAction(_prev: ReportActionState, fd: FormData): Promise<ReportActionState> {
  try {
    const actor = await writeActor();
    if (!can(actor.role, "reports.generate")) return { ok: false, error: "Only admins and auditors can rate moderators." };
    const date = String(fd.get("date") ?? "");
    const moderatorId = String(fd.get("moderatorId") ?? "");
    const values = ["languageTone","accuracy","callToAction","dataCollection","processCompliance"].map((k) => Number(fd.get(k)));
    if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 5)) return { ok: false, error: "Every score must be between 0 and 5." };
    let { data: report } = await supabaseAdmin().from("audit_daily_reports").select("id").eq("report_date", date).maybeSingle();
    if (!report) { await generateAuditReport(date); ({ data: report } = await supabaseAdmin().from("audit_daily_reports").select("id").eq("report_date", date).single()); }
    const { error } = await supabaseAdmin().from("audit_manual_scores").upsert({ daily_report_id: report!.id, score_type: `moderator:${moderatorId}`, language_tone: values[0], accuracy: values[1], call_to_action: values[2], data_collection: values[3], process_compliance: values[4], notes: String(fd.get("notes") ?? ""), created_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: "daily_report_id,score_type" });
    if (error) throw error;
    revalidatePath("/reports"); revalidatePath("/auditor");
    return { ok: true, message: "Moderator score saved." };
  } catch (err) { console.error("moderator score failed", err); return { ok: false, error: "The score could not be saved." }; }
}
