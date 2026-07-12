"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createOperationalReportAction, REPORT_IDLE, saveModeratorScoreAction } from "@/app/(crm)/reports/actions";
import { Card } from "@/components/ui/Card";
import type { ReportAutoData, ModeratorScorecard, ReportType } from "@/lib/data/reporting";
import type { SummaryReport, Role } from "@/lib/types";

const META: Record<string, { label: string; color: string; soft: string; icon: string }> = {
  moderator_daily_ar: { label: "Moderator report", color: "#067647", soft: "#ecfdf3", icon: "◆" },
  follow_up_daily_ar: { label: "Follow-up report", color: "#b54708", soft: "#fffaeb", icon: "↻" },
  auditor_clinic_daily_ar: { label: "Auditor report", color: "#4338ca", soft: "#eef2ff", icon: "✓" },
  financial_daily: { label: "Financial report", color: "#026aa2", soft: "#eff8ff", icon: "₤" },
  marketing_daily: { label: "Marketing report", color: "#c11574", soft: "#fdf2fa", icon: "◉" },
};
const input = "w-full rounded-lg border border-line-soft bg-white px-3 py-2 text-[12.5px] outline-none focus:border-primary";

async function copyImage(node: HTMLElement) {
  const clone = node.cloneNode(true) as HTMLElement;
  clone.style.width = "900px"; clone.style.maxHeight = "none"; clone.style.overflow = "visible"; clone.style.background = "white"; clone.style.padding = "28px";
  const html = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="956" height="1200"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${html}</div></foreignObject></svg>`;
  const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; });
  const canvas = document.createElement("canvas"); canvas.width = 956; canvas.height = Math.min(2400, Math.max(700, node.scrollHeight + 80));
  const ctx = canvas.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Image failed")), "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

function ExportButtons({ text, target }: { text: string; target: React.RefObject<HTMLDivElement | null> }) {
  const [done, setDone] = useState("");
  return <div className="flex gap-2">
    <button onClick={async () => { await navigator.clipboard.writeText(text); setDone("Text copied"); }} className="rounded-lg border border-line-soft bg-white px-3 py-2 text-[11.5px] font-bold text-ink-700 shadow-sm hover:border-primary">▣ Copy text</button>
    <button onClick={async () => { if (target.current) { await copyImage(target.current); setDone("Image copied"); } }} className="rounded-lg bg-primary px-3 py-2 text-[11.5px] font-bold text-white shadow-sm hover:bg-primary-hover">▧ Copy image</button>
    {done && <span className="self-center text-[11px] font-semibold text-emerald-700">{done}</span>}
  </div>;
}

function MiniCharts({ auto }: { auto: ReportAutoData }) {
  const max = Math.max(1, auto.payments, auto.refunds, auto.expenses);
  const funnel = [auto.totalLeads, auto.qualified, auto.booked];
  return <div className="grid gap-3 md:grid-cols-3">
    <div className="rounded-xl border border-blue-100 bg-blue-50 p-3"><b className="text-[11px] text-blue-800">Cash movement</b><div className="mt-3 flex h-28 items-end justify-around gap-3">{[["Collected",auto.payments,"bg-blue-500"],["Refunds",auto.refunds,"bg-rose-400"],["Costs",auto.expenses,"bg-amber-400"]].map(([l,v,c]) => <div key={String(l)} className="flex h-full flex-1 flex-col justify-end text-center"><span className="mb-1 text-[9px] font-bold">{Number(v).toLocaleString()}</span><div className={`${c} mx-auto w-10 rounded-t`} style={{height:`${Math.max(5,Number(v)/max*75)}%`}}/><span className="mt-1 text-[9px]">{l}</span></div>)}</div></div>
    <div className="rounded-xl border border-violet-100 bg-violet-50 p-3"><b className="text-[11px] text-violet-800">Conversion funnel</b><div className="mt-4 space-y-2">{funnel.map((v,i) => <div key={i} className="mx-auto rounded bg-violet-500 py-1 text-center text-[10px] font-bold text-white" style={{width:`${Math.max(25,v/Math.max(1,funnel[0])*100)}%`,opacity:1-i*.2}}>{["Leads","Qualified","Booked"][i]} · {v}</div>)}</div></div>
    <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><b className="text-[11px] text-emerald-800">Net performance</b><div className="flex h-28 items-center justify-center"><div className="flex h-24 w-24 items-center justify-center rounded-full border-[12px] border-emerald-400 bg-white text-center"><span className="text-[12px] font-black text-emerald-800">{(auto.payments-auto.refunds-auto.expenses).toLocaleString()}<small className="block text-[8px]">EGP net</small></span></div></div></div>
  </div>;
}

function MarketingCharts({ auto }: { auto: ReportAutoData }) {
  const rows = auto.marketingPlatforms;
  const maxLeads = Math.max(1, ...rows.map((row)=>row.leads));
  const maxRevenue = Math.max(1, ...rows.map((row)=>Math.max(0,row.revenue)));
  if (!rows.length) return <div className="rounded-xl border border-line-soft bg-canvas p-4 text-[12px] text-ink-500">No platform-attributed activity for this date.</div>;
  return <div className="space-y-3"><div className="grid gap-3 md:grid-cols-2"><div className="rounded-xl border border-pink-100 bg-pink-50 p-3"><b className="text-[11px] text-pink-800">Incoming leads by platform</b><div className="mt-3 space-y-2">{rows.map((row)=><div key={row.key}><div className="flex justify-between text-[9.5px] font-bold"><span>{row.label}</span><span>{row.leads}</span></div><div className="mt-0.5 h-2 rounded-full bg-white"><div className="h-2 rounded-full bg-pink-500" style={{width:`${row.leads/maxLeads*100}%`}}/></div></div>)}</div></div><div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3"><b className="text-[11px] text-cyan-800">Revenue by platform</b><div className="mt-3 space-y-2">{rows.map((row)=><div key={row.key}><div className="flex justify-between text-[9.5px] font-bold"><span>{row.label}</span><span>{row.revenue.toLocaleString()} EGP</span></div><div className="mt-0.5 h-2 rounded-full bg-white"><div className="h-2 rounded-full bg-cyan-500" style={{width:`${Math.max(0,row.revenue)/maxRevenue*100}%`}}/></div></div>)}</div></div></div><div className="overflow-x-auto rounded-xl border border-line-soft"><table className="w-full min-w-[680px] text-[10.5px]"><thead className="bg-canvas text-left uppercase text-ink-400"><tr>{["Platform","Leads","Booked","Attended","Procedures","Revenue","Booking rate","Attendance rate"].map((h)=><th key={h} className="px-2 py-2">{h}</th>)}</tr></thead><tbody>{rows.map((row)=><tr key={row.key} className="border-t border-line-faint"><td className="px-2 py-2 font-bold">{row.label}</td><td className="px-2">{row.leads}</td><td className="px-2">{row.booked}</td><td className="px-2">{row.attended}</td><td className="px-2">{row.procedureReservations}</td><td className="px-2 font-bold">{row.revenue.toLocaleString()} EGP</td><td className="px-2">{row.bookingRate}%</td><td className="px-2">{row.attendanceRate}%</td></tr>)}</tbody></table></div></div>;
}

function Creator({ date, role }: { date: string; role: Role }) {
  const [state, action, pending] = useActionState(createOperationalReportAction, REPORT_IDLE);
  const all = role === "admin" || role === "auditor";
  const types: ReportType[] = all ? ["moderator_daily_ar","follow_up_daily_ar","auditor_clinic_daily_ar","financial_daily","marketing_daily"] : ["moderator_daily_ar","follow_up_daily_ar"];
  const [type, setType] = useState<ReportType>(types[0]);
  return <Card className="overflow-hidden border-violet-200">
    <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white"><h2 className="text-[16px] font-black">Create a polished report</h2><p className="mt-1 text-[11.5px] text-violet-100">CRM totals are calculated automatically. Add the context that only your team knows.</p></div>
    <form action={action} className="grid gap-4 p-5 lg:grid-cols-[230px_1fr]">
      <div className="space-y-2"><input type="hidden" name="reportType" value={type}/><label className="text-[11px] font-bold text-ink-500">Report date<input type="date" name="date" defaultValue={date} className={`${input} mt-1`}/></label>{types.map((t) => { const m=META[t]; return <button key={t} type="button" onClick={()=>setType(t)} className="flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[12px] font-bold" style={{borderColor:type===t?m.color:"#e4e7ec",background:type===t?m.soft:"white",color:type===t?m.color:"#475467"}}><span>{m.icon}</span>{m.label}</button>; })}</div>
      <div className="space-y-3" dir="rtl"><textarea name="importantUpdates" rows={4} className={input} placeholder={type === "financial_daily" ? "ملاحظات مالية" : "تحديثات هامة: اسم العميل، آخر رد، والخطوة القادمة"}/><textarea name="intervention" rows={3} className={input} placeholder="حالات تحتاج لتدخل الإدارة أو الطبيب"/><textarea name="pendingCases" rows={3} className={input} placeholder="حالات معلقة: السبب وتاريخ المتابعة القادم"/>{type === "moderator_daily_ar" && <div className="grid grid-cols-2 gap-2"><input name="pending47" type="number" min="0" className={input} placeholder="معلقين 4-7 أيام"/><input name="pending7" type="number" min="0" className={input} placeholder="معلقين 7+ أيام"/></div>}{type === "follow_up_daily_ar" && <input name="overdueReasons" className={input} placeholder="أسباب المتابعات المتأخرة"/>}{(type==="moderator_daily_ar"||type==="follow_up_daily_ar")&&<details className="rounded-xl border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-[11.5px] font-black text-amber-800">Override automatically calculated data</summary><p className="my-2 text-[10.5px] text-amber-700">Leave fields blank to keep CRM totals. Every changed value will be tagged OVERRIDDEN in the finalized report.</p><div className="grid grid-cols-2 gap-2" dir="ltr">{(type==="moderator_daily_ar"?[["totalLeads","Total leads"],["contacted","Contacted"],["qualified","Qualified"],["booked","Booked"]]:[["followupsDue","Follow-ups due"],["followupsDone","Completed"],["postOpDue","Post-op due"],["postOpDone","Post-op done"]]).map(([key,label])=><input key={key} name={`override_${key}`} type="number" min="0" className={input} placeholder={label}/>)}</div><input name="overrideReason" className={`${input} mt-2`} placeholder="Reason for override"/></details>}<button disabled={pending} className="rounded-xl bg-ink-900 px-5 py-2.5 text-[12.5px] font-black text-white shadow-sm disabled:opacity-50">{pending?"Finalizing…":"Generate & finalize report"}</button>{state.error && <p className="text-[11.5px] font-bold text-red-600">{state.error}</p>}{state.ok && <p className="text-[11.5px] font-bold text-emerald-700">{state.message}</p>}</div>
    </form>
  </Card>;
}

function Scores({ date, rows }: { date: string; rows: ModeratorScorecard[] }) {
  if (!rows.length) return null;
  return <Card className="p-4"><h2 className="text-[14px] font-black text-ink-900">Moderator quality scores</h2><p className="mb-3 text-[11.5px] text-ink-500">Rate every dimension from 0–5. Average and change versus the prior 30 days are calculated automatically.</p><div className="space-y-3">{rows.map((r)=><ScoreRow key={r.id} date={date} row={r}/>)}</div></Card>;
}
function ScoreRow({date,row}:{date:string;row:ModeratorScorecard}) { const [state,action,pending]=useActionState(saveModeratorScoreAction,REPORT_IDLE); const fields:[[string,string],...Array<[string,string]>]=[["languageTone","Language / Tone"],["accuracy","Accuracy"],["callToAction","CTA / Sales"],["dataCollection","Data Collection"],["processCompliance","Compliance"]]; return <form action={action} className="rounded-xl border border-line-soft bg-canvas/50 p-3"><input type="hidden" name="date" value={date}/><input type="hidden" name="moderatorId" value={row.id}/><div className="mb-2 flex items-center gap-2"><b className="text-[12.5px]">{row.name}</b>{row.average!==null&&<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-black text-violet-700">{row.average.toFixed(1)} / 5</span>}{row.average!==null&&row.previousAverage!==null&&<span className={`text-[10.5px] font-bold ${row.average>=row.previousAverage?"text-emerald-700":"text-rose-600"}`}>{row.average>=row.previousAverage?"↑":"↓"} {Math.abs(row.average-row.previousAverage).toFixed(1)} vs prior month</span>}</div><div className="grid gap-2 md:grid-cols-5">{fields.map(([key,label])=><label key={key} className="text-[10px] font-bold text-ink-500">{label}<input name={key} type="number" min="0" max="5" step="0.5" required defaultValue={row.scores?.[key as keyof NonNullable<typeof row.scores>] ?? ""} className={`${input} mt-1`}/></label>)}</div><div className="mt-2 flex gap-2"><input name="notes" className={input} placeholder="Auditor notes (optional)"/><button disabled={pending} className="rounded-lg bg-violet-600 px-4 text-[11.5px] font-bold text-white">{pending?"Saving…":"Save score"}</button></div>{(state.error||state.message)&&<p className={`mt-1 text-[10.5px] font-bold ${state.error?"text-red-600":"text-emerald-700"}`}>{state.error||state.message}</p>}</form>; }

export function ReportsWorkspace({reports,selectedId,date,auto,scorecards,role}:{reports:SummaryReport[];selectedId?:string;date:string;auto:ReportAutoData;scorecards:ModeratorScorecard[];role:Role}) {
  const selected=useMemo(()=>reports.find(r=>r.id===selectedId)??reports[0],[reports,selectedId]);
  const reportRef=useRef<HTMLDivElement>(null);
  const m=selected?META[selected.reportType]??{label:selected.reportType,color:"#475467",soft:"#f2f4f7",icon:"▦"}:null;
  return <div className="min-h-0 flex-1 overflow-auto bg-canvas px-[18px] py-4"><div className="mx-auto flex max-w-[1500px] flex-col gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-[20px] font-black text-ink-900">Reports that are ready to share</h1><p className="text-[12px] text-ink-500">Create, review, compare and export operational reports from one place.</p></div><form><input type="date" name="date" defaultValue={date} className={input}/></form></div>
    <Creator date={date} role={role}/><Scores date={date} rows={scorecards}/>
    {selected && m ? <div className="grid gap-4 lg:grid-cols-[270px_1fr]">
      <aside className="space-y-2">{reports.map(r=>{const rm=META[r.reportType]??m;return <Link key={r.id} href={`/reports?id=${r.id}&date=${r.reportDate}`} className={`block rounded-xl border p-3 ${r.id===selected.id?"shadow-sm":"bg-white"}`} style={r.id===selected.id?{borderColor:rm.color,background:rm.soft}:{}}><span className="text-[10px] font-black" style={{color:rm.color}}>{rm.icon} {rm.label}</span><div className="mt-1 text-[12px] font-bold">{r.reportDate}</div><div className="text-[10px] text-ink-400">{r.generatedBy||"CRM"}</div></Link>})}</aside>
      <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="rounded-full px-2.5 py-1 text-[10.5px] font-black" style={{background:m.soft,color:m.color}}>{m.icon} {m.label}</span><span className="ml-2 text-[11px] text-ink-500">Finalized · {selected.reportDate}</span></div><ExportButtons text={selected.text} target={reportRef}/></div>
        <Card className="overflow-hidden"><div ref={reportRef} className="bg-white"><div className="h-2" style={{background:`linear-gradient(90deg,${m.color},#7c3aed)`}}/><div className="p-6"><div className="mb-5 flex items-start justify-between border-b border-line-soft pb-4"><div><div className="text-[11px] font-black uppercase tracking-[.18em]" style={{color:m.color}}>Aspects Clinica</div><h2 className="mt-1 text-[22px] font-black text-ink-900">{m.label}</h2></div><div className="rounded-xl px-3 py-2 text-right text-[11px] font-bold" style={{background:m.soft,color:m.color}}>{selected.reportDate}<small className="block opacity-70">FINAL REPORT</small></div></div>
          {selected.reportType==="financial_daily"&&<div className="mb-5"><MiniCharts auto={auto}/></div>}
          {selected.reportType==="marketing_daily"&&<div className="mb-5"><MarketingCharts auto={auto}/></div>}
          <pre dir="auto" className="whitespace-pre-wrap font-sans text-[13px] leading-7 text-ink-800">{selected.text}</pre>
        </div></div></Card>
      </div>
    </div>:<Card className="p-10 text-center text-[13px] text-ink-500">No reports yet. Create the first report above.</Card>}
  </div></div>;
}
