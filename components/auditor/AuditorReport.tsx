"use client";

import { useActionState, useState } from "react";
import {
  type AuditorActionState,
  generateReportAction,
  saveOverrideAction,
  finalizeReportAction,
  reopenReportAction,
} from "@/app/(crm)/auditor/actions";
import { Card } from "@/components/ui/Card";
import type { AuditReportDetail, DroppedLead, AuditorFilterOptions } from "@/lib/data/auditor";
import type { AuditorMetrics } from "@/lib/auditor/kpi";

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
  return (
    <div className={"rounded-control border p-3 " + (flagged ? "border-red-300 bg-red-50" : "border-line-soft bg-white")}>
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

export function AuditorReport({
  date,
  detail,
  droppedLeads,
  canGenerate,
  options,
  selectedDoctorId,
  selectedSpecialtyId,
  scopedPreview,
}: {
  date: string;
  detail: AuditReportDetail | null;
  droppedLeads: DroppedLead[];
  canGenerate: boolean;
  options: AuditorFilterOptions;
  selectedDoctorId: string;
  selectedSpecialtyId: string;
  scopedPreview: { metrics: AuditorMetrics; redFlags: Array<{ key: string; reason: string }> } | null;
}) {
  const [showDropped, setShowDropped] = useState(false);
  const editable = canGenerate && detail !== null && !finalized(detail.status);
  const selectCls =
    "rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary";

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <form method="get" action="/auditor" className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-semibold text-ink-500">Report day</label>
          <input
            type="date"
            name="date"
            defaultValue={date}
            className="rounded-control border border-line-soft px-2 py-1.5 text-[12px] outline-none focus:border-primary"
          />
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
          <button type="submit" className="h-8 rounded-control border border-line-soft px-3 text-[12px] font-semibold text-ink-700 hover:bg-line-faint/60">
            View
          </button>
        </form>
        {detail && <StatusBadge status={detail.status} />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canGenerate && (
            <ActionForm action={generateReportAction} date={date} variant={detail ? "ghost" : "primary"}>
              {detail ? "Regenerate" : "Generate report"}
            </ActionForm>
          )}
          {canGenerate && detail && !finalized(detail.status) && (
            <ActionForm action={finalizeReportAction} date={date}>Finalize</ActionForm>
          )}
          {canGenerate && detail && finalized(detail.status) && (
            <ActionForm action={reopenReportAction} date={date} variant="ghost">Reopen</ActionForm>
          )}
        </div>
      </Card>

      {scopedPreview && (
        <Card className="border-primary/30 bg-primary-soft/30 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-pill bg-primary px-2 py-0.5 text-[10px] font-semibold text-white">Filtered view</span>
            <span className="text-[12px] font-semibold text-ink-800">
              {scopeLabel(options, selectedDoctorId, selectedSpecialtyId)}
            </span>
            <span className="text-[11px] text-ink-500">— live breakdown for {date}, not part of the saved clinic-wide report</span>
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
          <div className="text-[14px] font-semibold text-ink-800">No report for {date}</div>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-ink-500">
            {canGenerate
              ? "Generate the daily report to compute the metrics from that day's CRM activity. You can then override values and finalize."
              : "This day has not been generated yet. Ask an auditor to generate it."}
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
                <div className="mb-1 text-[12px] font-bold text-ink-800">Dropped / Lost leads — {date}</div>
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
