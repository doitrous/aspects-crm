"use client";

import Link from "next/link";
import { useActionState, useMemo, useRef, useState } from "react";
import { createOperationalReportAction, saveModeratorScoreAction, type ReportActionState } from "@/app/(crm)/reports/actions";
import { DateField } from "@/components/ui/DateField";
import type { ModeratorScorecard, ReportAutoData, ReportType } from "@/lib/data/reporting";
import { formatDate } from "@/lib/format";
import type { Role, SummaryReport } from "@/lib/types";

const META: Record<string, { label: string; color: string; soft: string; purpose: string }> = {
  moderator_daily_ar: { label: "Moderator daily", color: "#067647", soft: "#ecfdf3", purpose: "Lead intake, response and conversion activity" },
  follow_up_daily_ar: { label: "Follow-up daily", color: "#b54708", soft: "#fffaeb", purpose: "Regular and post-op follow-up completion" },
  auditor_clinic_daily_ar: { label: "Clinic audit", color: "#4338ca", soft: "#eef2ff", purpose: "Clinic-wide review and intervention decisions" },
  financial_daily: { label: "Financial daily", color: "#026aa2", soft: "#eff8ff", purpose: "Collections, adjustments and costs" },
  marketing_daily: { label: "Marketing daily", color: "#c11574", soft: "#fdf2fa", purpose: "Platform attribution and booking outcomes" },
};
const FIELD = "w-full rounded-control border border-line bg-white px-3 py-2.5 text-[12.5px] outline-none focus:border-primary";
const IDLE: ReportActionState = { ok: false };

async function copyImage(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement;
  const height = Math.min(3200, Math.max(760, node.scrollHeight + 80));
  clone.style.width = "900px";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.background = "white";
  const html = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}"><foreignObject width="900" height="${height}"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
  const canvas = document.createElement("canvas"); canvas.width = 900; canvas.height = height;
  const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas unavailable");
  context.fillStyle = "#fff"; context.fillRect(0, 0, 900, height); context.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image failed")), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function ExportButtons({ text, target }: { text: string; target: React.RefObject<HTMLDivElement | null> }) {
  const [status, setStatus] = useState("");
  async function run(work: () => Promise<void>, success: string) { try { await work(); setStatus(success); } catch { setStatus("Copy failed — check browser clipboard permission"); } }
  return <div className="flex flex-wrap items-center gap-2"><button onClick={() => void run(() => navigator.clipboard.writeText(text), "Text copied")} className="rounded-control border border-line bg-white px-3 py-2 text-[11px] font-bold text-ink-700">Copy text</button><button onClick={() => target.current && void run(() => copyImage(target.current!), "Image copied")} className="rounded-control bg-primary px-3 py-2 text-[11px] font-bold text-white hover:bg-primary-hover">Copy image</button>{status && <span className="text-[10.5px] font-semibold text-ink-500">{status}</span>}</div>;
}

function AutomaticSnapshot({ auto }: { auto: ReportAutoData }) {
  const values = [
    ["New leads", auto.totalLeads], ["Contacted", auto.contacted], ["Qualified", auto.qualified], ["Booked", auto.booked],
    ["Follow-ups due", auto.followupsDue], ["Completed", auto.followupsDone], ["Collected", `${auto.payments.toLocaleString()} EGP`], ["Refunds", `${auto.refunds.toLocaleString()} EGP`],
  ];
  return <section><div className="mb-2 flex items-center justify-between"><div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">Step 2 · automatic facts</div><p className="mt-0.5 text-[10.5px] text-ink-400">Already calculated from live CRM data for {formatDate(auto.date)}. No extra Calculate button is needed.</p></div><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9.5px] font-black text-emerald-700">LIVE DATA LOADED</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{values.map(([label, value]) => <div key={String(label)} className="rounded-xl border border-line bg-slate-50 p-3"><div className="text-[9.5px] font-bold uppercase tracking-wide text-ink-400">{label}</div><div className="mt-1 text-[19px] font-black text-ink-900">{value}</div></div>)}</div></section>;
}

function Creator({ date, role, auto }: { date: string; role: Role; auto: ReportAutoData }) {
  const [state, action, pending] = useActionState(createOperationalReportAction, IDLE);
  const elevated = role === "admin" || role === "auditor";
  const types: ReportType[] = elevated ? ["moderator_daily_ar", "follow_up_daily_ar", "auditor_clinic_daily_ar", "financial_daily", "marketing_daily"] : ["moderator_daily_ar", "follow_up_daily_ar"];
  const [type, setType] = useState<ReportType>(types[0]);
  return <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
    <div className="border-b border-line bg-white p-5"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Create a finalized report</div><h2 className="mt-1 text-[20px] font-black text-ink-900">One guided flow</h2><p className="mt-1 text-[11.5px] text-ink-500">Choose the purpose, review the automatic facts, add human context, then finalize one locked copy.</p></div>
    <form action={action} className="space-y-5 p-4 sm:p-5">
      <input type="hidden" name="date" value={date} /><input type="hidden" name="reportType" value={type} />
      <section><div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-primary">Step 1 · choose report purpose</div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{types.map((value) => { const meta = META[value]; const active = value === type; return <button key={value} type="button" onClick={() => setType(value)} className="rounded-xl border p-3 text-left" style={{ borderColor: active ? meta.color : "#e4e7ec", background: active ? meta.soft : "white" }}><div className="text-[12px] font-black" style={{ color: active ? meta.color : "#344054" }}>{meta.label}</div><div className="mt-1 text-[10px] leading-snug text-ink-500">{meta.purpose}</div></button>; })}</div></section>
      <AutomaticSnapshot auto={auto} />
      <section><div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-primary">Step 3 · add context only humans know</div><div className="grid gap-3 lg:grid-cols-3" dir="rtl"><label className="text-[11px] font-bold text-ink-600">تحديثات هامة<textarea name="importantUpdates" rows={4} className={`${FIELD} mt-1`} placeholder={type === "financial_daily" ? "ملاحظات مالية وسبب أي حركة غير معتادة" : "اسم العميل، آخر رد، والخطوة القادمة"} /></label><label className="text-[11px] font-bold text-ink-600">تدخل مطلوب<textarea name="intervention" rows={4} className={`${FIELD} mt-1`} placeholder="حالات تحتاج لتدخل الإدارة أو الطبيب" /></label><label className="text-[11px] font-bold text-ink-600">حالات معلقة<textarea name="pendingCases" rows={4} className={`${FIELD} mt-1`} placeholder="السبب وتاريخ المتابعة القادم" /></label></div>
        {type === "moderator_daily_ar" && <div className="mt-3 grid gap-2 sm:grid-cols-2"><input name="pending47" type="number" min="0" className={FIELD} placeholder="Pending 4–7 days" /><input name="pending7" type="number" min="0" className={FIELD} placeholder="Pending 7+ days" /></div>}
        {type === "follow_up_daily_ar" && <input name="overdueReasons" className={`${FIELD} mt-3`} placeholder="Reasons for overdue follow-ups" />}
        {(type === "moderator_daily_ar" || type === "follow_up_daily_ar") && <details className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-[11.5px] font-black text-amber-900">Correct an automatic fact</summary><p className="my-2 text-[10.5px] text-amber-700">Use only when source data is known to be wrong. The finalized report labels the value as overridden and records the automatic value.</p><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{(type === "moderator_daily_ar" ? [["totalLeads", "Total leads"], ["contacted", "Contacted"], ["qualified", "Qualified"], ["booked", "Booked"]] : [["followupsDue", "Follow-ups due"], ["followupsDone", "Completed"], ["postOpDue", "Post-op due"], ["postOpDone", "Post-op done"]]).map(([key, label]) => <input key={key} name={`override_${key}`} type="number" min="0" className={FIELD} placeholder={label} />)}</div><input name="overrideReason" className={`${FIELD} mt-2`} placeholder="Required correction reason" /></details>}
      </section>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4"><button disabled={pending} className="h-10 rounded-control bg-primary px-5 text-[12px] font-black text-white hover:bg-primary-hover disabled:opacity-50">{pending ? "Finalizing…" : "Review complete · Finalize report"}</button><p className="text-[10.5px] text-ink-400">Finalization creates a saved, shareable copy. It does not change the CRM source data.</p></div>
      {state.error && <p className="text-[11.5px] font-bold text-danger">{state.error}</p>}{state.ok && <p className="text-[11.5px] font-bold text-success">{state.message}</p>}
    </form>
  </section>;
}

function FormattedReport({ text }: { text: string }) {
  return <div dir="auto" className="space-y-1 text-[16px] leading-[1.65] text-ink-800">{text.split("\n").map((line, index) => { const value = line.trim(); if (!value) return <div key={index} className="h-3" />; const heading = index === 0 || (/^[A-Z][A-Z &/–-]+$/.test(value) && !/\d/.test(value)) || (/[:：]$/.test(value) && !/\d/.test(value)); if (heading) return <h3 key={index} className={index === 0 ? "pb-3 text-[28px] font-black leading-tight text-ink-900" : "pt-5 text-[20px] font-black text-ink-900"}>{value}</h3>; return <p key={index} className="border-b border-slate-100 py-2 last:border-0">{value}</p>; })}</div>;
}

function Scores({ date, rows }: { date: string; rows: ModeratorScorecard[] }) {
  if (!rows.length) return null;
  return <details className="rounded-xl border border-line bg-panel shadow-sm"><summary className="cursor-pointer list-none p-5"><div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">Separate quality workflow</div><div className="mt-1 flex items-center justify-between"><div><h2 className="text-[17px] font-black text-ink-900">Moderator quality review</h2><p className="mt-1 text-[10.5px] text-ink-500">Scores attach to the selected day&apos;s audit snapshot. If none exists, one is created automatically.</p></div><span className="text-[20px] text-ink-400">+</span></div></summary><div className="space-y-3 border-t border-line p-4 sm:p-5">{rows.map((row) => <ScoreRow key={row.id} date={date} row={row} />)}</div></details>;
}

function ScoreRow({ date, row }: { date: string; row: ModeratorScorecard }) {
  const [state, action, pending] = useActionState(saveModeratorScoreAction, IDLE);
  const fields = [["languageTone", "Language / tone"], ["accuracy", "Accuracy"], ["callToAction", "CTA / sales"], ["dataCollection", "Data collection"], ["processCompliance", "Compliance"]] as const;
  return <form action={action} className="rounded-xl border border-line bg-slate-50/60 p-4"><input type="hidden" name="date" value={date} /><input type="hidden" name="moderatorId" value={row.id} /><div className="mb-3 flex flex-wrap items-center gap-2"><b className="text-[13px] text-ink-900">{row.name}</b>{row.average !== null && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-black text-primary">{row.average.toFixed(1)} / 5</span>}</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{fields.map(([key, label]) => <label key={key} className="text-[10px] font-bold text-ink-500">{label}<input name={key} type="number" min="0" max="5" step="0.5" required defaultValue={row.scores?.[key as keyof NonNullable<typeof row.scores>] ?? ""} className={`${FIELD} mt-1`} /></label>)}</div><div className="mt-3 flex flex-wrap gap-2"><input name="notes" className={`${FIELD} min-w-[220px] flex-1`} placeholder="Auditor notes (optional)" /><button disabled={pending} className="rounded-control bg-primary px-4 py-2 text-[11.5px] font-bold text-white">{pending ? "Saving…" : "Save quality review"}</button></div>{(state.error || state.message) && <p className={`mt-2 text-[10.5px] font-bold ${state.error ? "text-danger" : "text-success"}`}>{state.error || state.message}</p>}</form>;
}

export function ReportsWorkspace({ reports, selectedId, date, auto, scorecards, role, warning }: { reports: SummaryReport[]; selectedId?: string; date: string; auto: ReportAutoData; scorecards: ModeratorScorecard[]; role: Role; warning?: string }) {
  const selected = useMemo(() => reports.find((report) => report.id === selectedId) ?? reports[0], [reports, selectedId]);
  const reportRef = useRef<HTMLDivElement>(null);
  const meta = selected ? META[selected.reportType] ?? { label: selected.reportType, color: "#344054", soft: "#f2f4f7", purpose: "Operational report" } : null;
  return <main className="min-h-0 flex-1 overflow-auto bg-canvas p-3 sm:p-[18px]"><div className="mx-auto max-w-[1500px] space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3"><div><h1 className="text-[24px] font-black text-ink-950">Reports</h1><p className="mt-0.5 text-[12px] text-ink-500">Create, review and export finalized operational records.</p></div><form method="get" className="flex items-end gap-2"><label className="text-[10px] font-bold text-ink-500">Working date<DateField name="date" defaultValue={date} ariaLabel="Reports working date" className="mt-1" /></label><button className="h-9 rounded-md bg-primary px-3 text-[11px] font-black text-white hover:bg-primary-hover">Load date</button></form></div>
    {warning && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11.5px] font-bold text-amber-800">{warning}</div>}
    <Creator date={date} role={role} auto={auto} /><Scores date={date} rows={scorecards} />
    {selected && meta ? <section className="grid gap-4 lg:grid-cols-[260px_1fr]"><aside className="space-y-2 rounded-xl border border-line bg-panel p-3"><div className="px-1 pb-2 text-[10px] font-black uppercase tracking-[0.14em] text-ink-400">Finalized reports</div>{reports.map((report) => { const item = META[report.reportType] ?? meta; const active = report.id === selected.id; return <Link key={report.id} href={`/reports?id=${report.id}&date=${report.reportDate}`} className="block rounded-xl border p-3" style={{ borderColor: active ? item.color : "#e4e7ec", background: active ? item.soft : "white" }}><div className="text-[11px] font-black" style={{ color: item.color }}>{item.label}</div><div className="mt-1 text-[12px] font-bold text-ink-800">{formatDate(report.reportDate)}</div><div className="mt-0.5 text-[10px] text-ink-400">{report.generatedBy || "CRM"}</div></Link>; })}</aside><div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: meta.soft, color: meta.color }}>{meta.label}</span><span className="ms-2 text-[10.5px] text-ink-400">Finalized · {formatDate(selected.reportDate)}</span></div><ExportButtons text={selected.text} target={reportRef} /></div><div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm"><div ref={reportRef} className="bg-white"><div className="h-3" style={{ background: meta.color }} /><div className="p-7 sm:p-10"><div className="mb-7 flex items-start justify-between gap-5 border-b-2 border-ink-900 pb-5"><div><div className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: meta.color }}>Aspects Clinica</div><div className="mt-2 text-[30px] font-black leading-tight text-ink-900">{meta.label}</div><div className="mt-1 text-[13px] text-ink-500">{meta.purpose}</div></div><div className="text-right"><div className="text-[15px] font-black text-ink-900">{formatDate(selected.reportDate)}</div><div className="mt-1 text-[10px] font-black uppercase tracking-wide" style={{ color: meta.color }}>Final report</div></div></div><FormattedReport text={selected.text} /><div className="mt-8 border-t border-line pt-4 text-[10px] font-semibold text-ink-400">Generated from Aspects Clinica CRM · finalized operational record</div></div></div></div></div></section> : <div className="rounded-xl border border-line bg-panel p-10 text-center text-[13px] text-ink-500">No finalized reports yet. Use the guided flow above to create the first one.</div>}
  </div></main>;
}
