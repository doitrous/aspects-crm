"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import {
  type AuditorActionState,
  generateReportAction,
  saveOverrideAction,
  finalizeReportAction,
  reopenReportAction,
} from "@/app/(crm)/auditor/actions";
import { Card } from "@/components/ui/Card";
import type {
  AuditReportDetail,
  DroppedLead,
  AuditorFilterOptions,
  AuditorTrendPoint,
} from "@/lib/data/auditor";
import type { AuditorMetrics } from "@/lib/auditor/kpi";
import { QuickCopy } from "@/components/reports/QuickCopy";
import { DateField } from "@/components/ui/DateField";
import { formatDate } from "@/lib/format";
import { useRouter } from "next/navigation";

type Fmt = "int" | "pct" | "egp";

const AUDITOR_IDLE: AuditorActionState = { ok: false };

const FMT: Record<string, Fmt> = {
  total_leads: "int",
  qualified_leads: "int",
  booked_leads: "int",
  dropped_leads: "int",
  escalations_sent: "int",
  total_payment_egp: "egp",
  marketing_spend_egp: "egp",
  target_cpl: "egp",
  cpl: "egp",
  cost_per_booking: "egp",
  cost_per_qualified_lead: "egp",
  qualification_percent: "pct",
  booking_percent: "pct",
  drop_off_percent: "pct",
  booking_conversion_rate: "pct",
};

function fmt(key: string, v: number): string {
  const f = FMT[key] ?? "int";
  if (f === "pct") return `${v}%`;
  if (f === "egp") return `${v.toLocaleString("en-US")} EGP`;
  return v.toLocaleString("en-US");
}

const finalized = (status: string) => status === "submitted" || status === "approved";

function StatusBadge({ status }: { status: string }) {
  const meta: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-line-faint text-ink-600" },
    reopened: { label: "Reopened", cls: "bg-amber-100 text-amber-700" },
    submitted: { label: "Finalized", cls: "bg-emerald-100 text-emerald-700" },
    approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  };
  const m = meta[status] ?? meta.draft;
  return <span className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}

function OverrideForm({
  date,
  metricKey,
  autoValue,
  override,
  editable,
}: {
  date: string;
  metricKey: string;
  autoValue: number;
  override?: { value: number; reason: string };
  editable: boolean;
}) {
  const [state, action, pending] = useActionState(saveOverrideAction, AUDITOR_IDLE);
  const [open, setOpen] = useState(false);
  if (!editable) return null;
  return (
    <div className="mt-1">
      <button onClick={() => setOpen((o) => !o)} className="text-[10.5px] font-semibold text-primary hover:underline">
        {override ? "Edit override" : "Override"}
      </button>
      {open && (
        <form action={action} className="mt-1 flex flex-col gap-1.5 rounded-control border border-line-soft bg-white p-2">
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="metricKey" value={metricKey} />
          <input
            type="number"
            step="any"
            name="value"
            defaultValue={override?.value ?? ""}
            placeholder={`auto: ${autoValue}`}
            className="rounded-control border border-line-soft px-2 py-1 text-[12px] outline-none focus:border-primary"
          />
          <input
            name="reason"
            defaultValue={override?.reason ?? ""}
            placeholder="Reason (required)"
            className="rounded-control border border-line-soft px-2 py-1 text-[11.5px] outline-none focus:border-primary"
          />
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} className="h-7 rounded-control bg-primary px-2 text-[11px] font-semibold text-white disabled:opacity-60">
              {pending ? "…" : "Save"}
            </button>
            <span className="text-[10px] text-ink-400">Clear the value to remove the override.</span>
          </div>
          {state.error && <span className="text-[10.5px] font-semibold text-red-600">{state.error}</span>}
          {state.ok && state.message && <span className="text-[10.5px] font-semibold text-emerald-600">{state.message}</span>}
        </form>
      )}
    </div>
  );
}

function Metric({
  label,
  metricKey,
  detail,
  date,
  editable,
  flagged,
  onClick,
}: {
  label: string;
  metricKey: string;
  detail: AuditReportDetail;
  date: string;
  editable: boolean;
  flagged?: boolean;
  onClick?: () => void;
}) {
  const value = detail.metrics[metricKey] ?? 0;
  const auto = detail.autoMetrics[metricKey] ?? 0;
  const override = detail.overrides[metricKey];
  const isBase = editable && metricKey in FMT && !metricKey.includes("percent") && !["cpl", "cost_per_booking", "cost_per_qualified_lead"].includes(metricKey);
  const semantic = /dropped|missed|overdue|red.flag|unanswered|waiting/i.test(metricKey)
    ? "border-rose-200 bg-rose-50"
    : /booked|completed|qualified/i.test(metricKey)
      ? "border-emerald-200 bg-emerald-50"
      : /payment|cost|cpl|spend/i.test(metricKey)
        ? "border-blue-200 bg-blue-50"
        : "border-line-soft bg-panel";
  return (
    <div className={"rounded-control border p-3 " + (flagged ? "border-red-300 bg-red-50" : semantic)}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <button
        onClick={onClick}
        disabled={!onClick}
        className={"mt-0.5 text-[19px] font-bold text-ink-900 " + (onClick ? "cursor-pointer hover:underline" : "cursor-default")}
      >
        {fmt(metricKey, value)}
      </button>
      {override && (
        <div className="text-[10.5px] text-amber-700" title={override.reason}>
          overridden · auto {fmt(metricKey, auto)}
        </div>
      )}
      {isBase && (
        <OverrideForm date={date} metricKey={metricKey} autoValue={auto} override={override} editable={editable} />
      )}
    </div>
  );
}

function ActionForm({
  action,
  date,
  children,
  variant = "primary",
}: {
  action: typeof generateReportAction;
  date: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
}) {
  const [state, formAction, pending] = useActionState(action, AUDITOR_IDLE);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="date" value={date} />
      <button
        type="submit"
        disabled={pending}
        className={
          "h-8 rounded-control px-3 text-[12px] font-semibold disabled:opacity-60 " +
          (variant === "primary" ? "bg-primary text-white hover:bg-primary-hover" : "border border-line-soft text-ink-700 hover:bg-line-faint/60")
        }
      >
        {pending ? "…" : children}
      </button>
      {state.error && <span className="text-[11px] font-semibold text-red-600">{state.error}</span>}
      {state.ok && state.message && <span className="text-[11px] font-semibold text-emerald-600">{state.message}</span>}
    </form>
  );
}

function scopeLabel(
  options: AuditorFilterOptions,
  doctorId: string,
  specialtyId: string,
): string {
  if (doctorId) return options.doctors.find((d) => d.id === doctorId)?.name ?? "selected doctor";
  if (specialtyId) return options.specialties.find((s) => s.id === specialtyId)?.name ?? "selected specialty";
  return "";
}

function AuditorTrendChart({ rows }: { rows: AuditorTrendPoint[] }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.totalLeads, row.booked, row.dropped]));
  const width = 700;
  const height = 220;
  const left = 24;
  const top = 18;
  const plotWidth = width - left * 2;
  const plotHeight = 120;
  const x = (index: number) => left + (plotWidth * index) / Math.max(1, rows.length - 1);
  const y = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const points = (key: "totalLeads" | "booked" | "dropped") =>
    rows.map((row, index) => `${x(index)},${y(row[key])}`).join(" ");

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-col gap-2 border-b border-line-faint px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">Live activity graph</div>
          <h2 className="mt-0.5 text-[18px] font-bold text-ink-950">Seven-day lead movement</h2>
          <p className="mt-0.5 text-[12px] text-ink-500">Ends on the selected day and follows the active doctor or specialty filter.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] font-semibold text-ink-600">
          <span><i className="me-1 inline-block size-2 rounded-full bg-slate-800" />Leads</span>
          <span><i className="me-1 inline-block size-2 rounded-full bg-emerald-500" />Booked</span>
          <span><i className="me-1 inline-block size-2 rounded-full bg-red-500" />Dropped</span>
        </div>
      </div>
      <div className="overflow-x-auto px-3 pb-2 pt-3">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[220px] min-w-[760px] w-full" role="img" aria-label="Seven-day auditor lead trend">
          {[0, 0.5, 1].map((ratio) => (
            <g key={ratio}>
              <line x1={left} x2={width - left} y1={top + plotHeight * ratio} y2={top + plotHeight * ratio} stroke="#e5e7eb" strokeWidth="1" />
              <text x={left} y={top + plotHeight * ratio - 5} fill="#94a3b8" fontSize="10">{Math.round(max * (1 - ratio))}</text>
            </g>
          ))}
          <polyline fill="none" stroke="#1e293b" strokeWidth="3" strokeLinejoin="round" points={points("totalLeads")} />
          <polyline fill="none" stroke="#10b981" strokeWidth="3" strokeLinejoin="round" points={points("booked")} />
          <polyline fill="none" stroke="#ef4444" strokeWidth="3" strokeLinejoin="round" points={points("dropped")} />
          {rows.map((row, index) => (
            <g key={row.date}>
              <circle cx={x(index)} cy={y(row.totalLeads)} r="3.5" fill="#1e293b" />
              <circle cx={x(index)} cy={y(row.booked)} r="3.5" fill="#10b981" />
              <circle cx={x(index)} cy={y(row.dropped)} r="3.5" fill="#ef4444" />
              <text transform={`translate(${x(index) - 3} ${height - 12}) rotate(-32)`} textAnchor="end" fill="#64748b" fontSize="9">
                {formatDate(row.date)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </Card>
  );
}

export function AuditorReport({
  date,
  detail,
  droppedLeads,
  canGenerate,
  options,
  selectedDoctorId,
  selectedSpecialtyId,
  scopedPreview,
  trend,
}: {
  date: string;
  detail: AuditReportDetail | null;
  droppedLeads: DroppedLead[];
  canGenerate: boolean;
  options: AuditorFilterOptions;
  selectedDoctorId: string;
  selectedSpecialtyId: string;
  scopedPreview: { metrics: AuditorMetrics; redFlags: Array<{ key: string; reason: string }> } | null;
  trend: AuditorTrendPoint[];
}) {
  const [showDropped, setShowDropped] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [applying, startApply] = useTransition();
  const [applyMessage, setApplyMessage] = useState("");
  const editable = canGenerate && detail !== null && !finalized(detail.status);
  const selectCls =
    "rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary";
  const shareText = detail ? [`Auditor report — ${formatDate(date)}`, ...Object.entries(detail.metrics).map(([key,value]) => `${key}: ${value}${detail.overrides[key] ? ` [OVERRIDDEN — ${detail.overrides[key].reason}]` : ""}`)].join("\n") : "";

  function applyView(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextDate = String(formData.get("date") ?? date);
    const params = new URLSearchParams();
    params.set("date", nextDate);
    const specialtyId = String(formData.get("specialtyId") ?? "");
    const doctorId = String(formData.get("doctorId") ?? "");
    if (specialtyId) params.set("specialtyId", specialtyId);
    if (doctorId) params.set("doctorId", doctorId);
    startApply(async () => {
      const state = await generateReportAction(AUDITOR_IDLE, formData);
      setApplyMessage(state.error ?? state.message ?? "");
      router.push(`/auditor?${params.toString()}`);
      router.refresh();
    });
  }

  return (
    <div ref={reportRef} className="flex flex-col gap-4 bg-canvas">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div><h1 className="text-[24px] font-bold text-ink-950">Daily audit</h1><p className="mt-0.5 text-[12px] text-ink-500">Review evidence, explain overrides and lock one source of truth.</p></div>
        <div className="flex items-center gap-2">{detail && <StatusBadge status={detail.status} />}<span className="rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-[13px] font-black text-primary">Report date · {formatDate(date)}</span></div>
      </div>

      <Card className="flex flex-wrap items-center gap-3 p-3">
        <form onSubmit={applyView} className="flex flex-wrap items-center gap-2">
          <label className="w-full text-[11px] font-bold uppercase tracking-wide text-ink-400 sm:w-auto">View date and scope</label>
          <DateField name="date" defaultValue={date} ariaLabel="Auditor report date" />
          {options.specialties.length > 0 && (
            <select name="specialtyId" defaultValue={selectedSpecialtyId} className={selectCls} title="Scope by specialty">
              <option value="">All specialties</option>
              {options.specialties.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
          {options.doctors.length > 0 && (
            <select name="doctorId" defaultValue={selectedDoctorId} className={selectCls} title="Scope by doctor (overrides specialty)">
              <option value="">All doctors</option>
              {options.doctors.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
          <button type="submit" disabled={applying} className="h-9 rounded-control bg-primary px-4 text-[12px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">
            {applying ? "Applying…" : "Apply view"}
          </button>
        </form>
        <div className="ms-auto text-right text-[11px] text-ink-500"><div>{selectedDoctorId || selectedSpecialtyId ? `Filtered: ${scopeLabel(options, selectedDoctorId, selectedSpecialtyId)}` : "Clinic-wide view"}</div><div className="mt-0.5 font-semibold text-primary">{applyMessage || "Apply view refreshes the live snapshot automatically."}</div></div>
      </Card>

      <Card className="p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`rounded-control border p-3 ${detail ? "border-emerald-200 bg-emerald-50" : "border-primary/30 bg-primary-soft/30"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">1 · Snapshot</span>
              <span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${detail ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>{detail ? "Ready" : "Needed"}</span>
            </div>
            <p className="my-2 text-[12px] leading-5 text-ink-600">Apply View above captures the current CRM activity for this date and preserves documented overrides.</p>
            <span className="text-[11px] font-bold text-primary">Automatically refreshed by Apply View</span>
          </div>
          <div className={`rounded-control border p-3 ${editable ? "border-amber-200 bg-amber-50" : "border-line-soft bg-panel"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">2 · Review</span>
              <span className="text-[10px] font-bold text-ink-500">{detail ? `${Object.keys(detail.overrides).length} override${Object.keys(detail.overrides).length === 1 ? "" : "s"}` : "Waiting"}</span>
            </div>
            <p className="my-2 text-[12px] leading-5 text-ink-600">Inspect flags and source metrics below. Override only a base value and always record the evidence.</p>
            {detail && <QuickCopy text={shareText} target={reportRef} />}
          </div>
          <div className={`rounded-control border p-3 ${detail && finalized(detail.status) ? "border-emerald-200 bg-emerald-50" : "border-line-soft bg-panel"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-ink-500">3 · Finalize</span>
              <span className="text-[10px] font-bold text-ink-500">{detail && finalized(detail.status) ? "Locked" : "Open"}</span>
            </div>
            <p className="my-2 text-[12px] leading-5 text-ink-600">Finalize publishes the report and locks edits. Reopen only when the audit record must change.</p>
            {canGenerate && detail && !finalized(detail.status) && (
              <ActionForm action={finalizeReportAction} date={date}>Finalize &amp; lock</ActionForm>
            )}
            {canGenerate && detail && finalized(detail.status) && (
              <ActionForm action={reopenReportAction} date={date} variant="ghost">Reopen for correction</ActionForm>
            )}
          </div>
        </div>
      </Card>

      <AuditorTrendChart rows={trend} />

      {scopedPreview && (
        <Card className="border-primary/30 bg-primary-soft/30 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-pill bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">Filtered view</span>
            <span className="text-[12px] font-semibold text-ink-800">
              {scopeLabel(options, selectedDoctorId, selectedSpecialtyId)}
            </span>
            <span className="text-[11px] text-ink-500">— live breakdown for {formatDate(date)}, not part of the saved clinic-wide report</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ["Total leads", "total_leads"],
              ["Qualified", "qualified_leads"],
              ["Booked", "booked_leads"],
              ["Dropped", "dropped_leads"],
              ["Escalations", "escalations_sent"],
              ["Payments", "total_payment_egp"],
              ["Qualification %", "qualification_percent"],
              ["Booking %", "booking_percent"],
              ["Drop-off %", "drop_off_percent"],
              ["Booking conv.", "booking_conversion_rate"],
              ["Cost / booking", "cost_per_booking"],
              ["CPL", "cpl"],
            ].map(([label, key]) => (
              <div key={key} className="rounded-control border border-line-soft bg-panel p-2.5">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
                <div className="mt-0.5 text-[16px] font-bold text-ink-900">
                  {fmt(key, scopedPreview.metrics[key] ?? 0)}
                </div>
              </div>
            ))}
          </div>
          {scopedPreview.redFlags.length > 0 && (
            <div className="mt-2 text-[11.5px] font-semibold text-red-600">
              {scopedPreview.redFlags.map((f) => f.reason).join(" · ")}
            </div>
          )}
        </Card>
      )}

      {!detail && (
        <Card className="p-8 text-center">
          <div className="text-[18px] font-bold text-ink-900">This day has no saved snapshot yet</div>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-ink-500">
            {canGenerate
              ? "Use Apply View above. The system will load CRM facts, then unlock review and finalization."
              : "Ask an auditor or administrator to create the daily snapshot."}
          </p>
        </Card>
      )}

      {detail && (
        <>
          {detail.redFlags.length > 0 && (
            <Card className="border-red-300 bg-red-50 p-3">
              <div className="text-[12px] font-bold text-red-700">Red flags</div>
              <ul className="mt-1 list-inside list-disc text-[12px] text-red-700">
                {detail.redFlags.map((f) => (
                  <li key={f.key}>{f.reason}</li>
                ))}
              </ul>
            </Card>
          )}

          <section>
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">Finance</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Total payment" metricKey="total_payment_egp" detail={detail} date={date} editable={editable} />
              <Metric label="Marketing spend" metricKey="marketing_spend_egp" detail={detail} date={date} editable={editable} />
              <Metric label="Total leads" metricKey="total_leads" detail={detail} date={date} editable={editable} />
              <Metric label="CPL" metricKey="cpl" detail={detail} date={date} editable={editable} flagged={detail.redFlags.some((f) => f.key === "cpl")} />
              <Metric label="Target CPL" metricKey="target_cpl" detail={detail} date={date} editable={false} />
              <Metric label="Cost / booking" metricKey="cost_per_booking" detail={detail} date={date} editable={false} />
              <Metric label="Cost / qualified" metricKey="cost_per_qualified_lead" detail={detail} date={date} editable={false} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">Moderator report</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="Total leads" metricKey="total_leads" detail={detail} date={date} editable={editable} />
              <Metric label="Qualified" metricKey="qualified_leads" detail={detail} date={date} editable={editable} />
              <Metric label="Booked" metricKey="booked_leads" detail={detail} date={date} editable={editable} />
              <Metric
                label="Dropped / Lost"
                metricKey="dropped_leads"
                detail={detail}
                date={date}
                editable={editable}
                flagged={detail.redFlags.some((f) => f.key === "drop_off_percent")}
                onClick={() => setShowDropped((s) => !s)}
              />
              <Metric label="Escalations" metricKey="escalations_sent" detail={detail} date={date} editable={editable} flagged={detail.redFlags.some((f) => f.key === "escalations_sent")} />
            </div>
            {showDropped && (
              <Card className="mt-2 p-3">
                <div className="mb-1 text-[12px] font-bold text-ink-800">Dropped / Lost leads — {formatDate(date)}</div>
                {droppedLeads.length === 0 ? (
                  <p className="text-[12px] text-ink-400">No leads created this day are marked Lost.</p>
                ) : (
                  <ul className="divide-y divide-line-faint">
                    {droppedLeads.map((l) => (
                      <li key={l.leadId} className="flex flex-wrap items-center gap-2 py-1.5">
                        <a href={`/leads/${l.leadId}`} className="font-mono text-[11px] font-semibold text-primary hover:underline">
                          {l.leadId}
                        </a>
                        <span className="text-[12.5px] font-semibold text-ink-900">{l.name}</span>
                        <span className="rounded-pill bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold text-red-600">
                          {l.lostReason ?? "No reason recorded"}
                        </span>
                        {l.lostNotes && <span className="text-[11px] text-ink-500">— {l.lostNotes}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">KPIs</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Metric label="Qualification %" metricKey="qualification_percent" detail={detail} date={date} editable={false} />
              <Metric label="Booking %" metricKey="booking_percent" detail={detail} date={date} editable={false} />
              <Metric label="Drop-off %" metricKey="drop_off_percent" detail={detail} date={date} editable={false} flagged={detail.redFlags.some((f) => f.key === "drop_off_percent")} />
              <Metric label="Cost / booking" metricKey="cost_per_booking" detail={detail} date={date} editable={false} />
              <Metric label="Booking conversion" metricKey="booking_conversion_rate" detail={detail} date={date} editable={false} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
