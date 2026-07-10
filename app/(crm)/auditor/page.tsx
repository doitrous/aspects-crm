import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { auditorReport, auditorReportDates } from "@/lib/data";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

type Fmt = "int" | "pct" | "min" | "egp" | "score";

interface MetricDef {
  key: string;
  label: string;
  fmt: Fmt;
}

interface Section {
  title: string;
  metrics: MetricDef[];
}

// Ordered catalog. Any snapshot key not listed here is surfaced in an
// "Additional metrics" section so nothing is silently dropped.
const SECTIONS: Section[] = [
  {
    title: "Lead funnel",
    metrics: [
      { key: "total_leads", label: "Total leads", fmt: "int" },
      { key: "new_leads", label: "New leads", fmt: "int" },
      { key: "qualified_leads", label: "Qualified", fmt: "int" },
      { key: "booked_leads", label: "Booked", fmt: "int" },
      { key: "follow_up_leads", label: "In follow-up", fmt: "int" },
      { key: "post_op_follow_up_leads", label: "Post-op follow-up", fmt: "int" },
      { key: "dropped_leads", label: "Dropped", fmt: "int" },
      { key: "unread_leads_count", label: "Unread leads", fmt: "int" },
    ],
  },
  {
    title: "Conversion",
    metrics: [
      { key: "qualification_percent", label: "Qualification rate", fmt: "pct" },
      { key: "booking_percent", label: "Booking rate", fmt: "pct" },
      { key: "booking_from_qualified_rate", label: "Booked / qualified", fmt: "pct" },
      { key: "booking_conversion_rate", label: "Booking conversion", fmt: "pct" },
      { key: "drop_off_percent", label: "Drop-off rate", fmt: "pct" },
      { key: "duplicate_rate_percent", label: "Duplicate rate", fmt: "pct" },
    ],
  },
  {
    title: "Follow-ups",
    metrics: [
      { key: "total_new_follow_ups", label: "New follow-ups", fmt: "int" },
      { key: "completed_follow_ups", label: "Completed", fmt: "int" },
      { key: "missed_follow_ups", label: "Missed", fmt: "int" },
      { key: "overdue_follow_ups", label: "Overdue", fmt: "int" },
      { key: "dropped_follow_ups", label: "Dropped", fmt: "int" },
      { key: "follow_up_completion_percent", label: "Completion rate", fmt: "pct" },
    ],
  },
  {
    title: "Response & SLA",
    metrics: [
      { key: "average_first_response_minutes", label: "Avg first response", fmt: "min" },
      { key: "average_subsequent_response_minutes", label: "Avg reply", fmt: "min" },
      { key: "average_current_unread_age_minutes", label: "Avg unread age", fmt: "min" },
      { key: "overdue_replies_count", label: "Overdue replies", fmt: "int" },
      { key: "incoming_unanswered_count", label: "Unanswered", fmt: "int" },
      { key: "patient_waiting_count", label: "Waiting patients", fmt: "int" },
      { key: "wait_over_30_count", label: "Waiting > 30 min", fmt: "int" },
      { key: "no_reply_conversations", label: "No-reply chats", fmt: "int" },
    ],
  },
  {
    title: "Quality & risk",
    metrics: [
      { key: "ai_audit_score", label: "AI audit score", fmt: "score" },
      { key: "manual_auditor_score", label: "Manual score", fmt: "score" },
      { key: "red_flag_conversations", label: "Red-flag chats", fmt: "int" },
      { key: "escalations_sent", label: "Escalations sent", fmt: "int" },
      { key: "escalated_queue_count", label: "Escalation queue", fmt: "int" },
      { key: "duplicate_queue_count", label: "Duplicate queue", fmt: "int" },
    ],
  },
  {
    title: "Cost",
    metrics: [
      { key: "cpl", label: "Cost per lead", fmt: "egp" },
      { key: "target_cpl", label: "Target CPL", fmt: "egp" },
      { key: "cost_per_qualified_lead", label: "Cost / qualified", fmt: "egp" },
      { key: "cost_per_booking", label: "Cost / booking", fmt: "egp" },
      { key: "total_payment_egp", label: "Total payments", fmt: "egp" },
    ],
  },
];

const KNOWN_KEYS = new Set(SECTIONS.flatMap((s) => s.metrics.map((m) => m.key)));

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: "#f2f4f7", fg: "#475467" },
  submitted: { label: "Submitted", bg: "#eff8ff", fg: "#175cd3" },
  approved: { label: "Approved", bg: "#ecfdf3", fg: "#067647" },
  reopened: { label: "Reopened", bg: "#fffaeb", fg: "#b54708" },
};

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function num(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatMetric(value: number, fmt: Fmt): string {
  switch (fmt) {
    case "pct":
      return `${num(value)}%`;
    case "min":
      return `${num(value)} min`;
    case "egp":
      return `EGP ${num(value)}`;
    case "score":
      return `${num(value)}`;
    default:
      return num(value);
  }
}

function MetricTile({
  def,
  value,
  overridden,
}: {
  def: MetricDef;
  value: number;
  overridden: boolean;
}) {
  return (
    <div className="rounded-control border border-line-soft bg-panel p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-ink-400">{def.label}</span>
        {overridden && (
          <span
            className="rounded-pill bg-[#fffaeb] px-1.5 py-0.5 text-[9px] font-semibold text-warn"
            title="Manually overridden by auditor"
          >
            edited
          </span>
        )}
      </div>
      <div
        className={
          "mt-1 text-[19px] font-bold tabular-nums " +
          (def.fmt === "score" ? "text-primary" : "text-ink-900")
        }
      >
        {formatMetric(value, def.fmt)}
        {def.fmt === "score" && <span className="text-[12px] font-medium text-ink-400"> / 100</span>}
      </div>
    </div>
  );
}

export default async function AuditorPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  const [report, dates] = await Promise.all([auditorReport(date), auditorReportDates()]);

  // Date navigation: report dates come back newest-first.
  const idx = report ? dates.indexOf(report.date) : -1;
  const older = idx >= 0 && idx < dates.length - 1 ? dates[idx + 1] : undefined;
  const newer = idx > 0 ? dates[idx - 1] : undefined;

  const nav = (
    <div className="flex items-center gap-1.5">
      <Link
        href={older ? `/auditor?date=${older}` : "#"}
        aria-disabled={!older}
        className={
          "rounded-control border border-line px-2.5 py-1.5 text-[12px] font-medium " +
          (older
            ? "text-ink-600 hover:bg-line-faint"
            : "pointer-events-none text-ink-300")
        }
      >
        ← Older
      </Link>
      <Link
        href={newer ? `/auditor?date=${newer}` : "#"}
        aria-disabled={!newer}
        className={
          "rounded-control border border-line px-2.5 py-1.5 text-[12px] font-medium " +
          (newer
            ? "text-ink-600 hover:bg-line-faint"
            : "pointer-events-none text-ink-300")
        }
      >
        Newer →
      </Link>
    </div>
  );

  if (!report) {
    return (
      <>
        <Topbar title="Auditor Dashboard" action={dates.length > 0 ? nav : undefined} />
        <div className="flex-1 overflow-auto">
          <EmptyState
            title="No audit report for this day"
            hint="Reports are generated per day from the previous day's activity snapshot."
          />
        </div>
      </>
    );
  }

  const sm = STATUS_META[report.status] ?? STATUS_META.draft;
  const overrides = new Set(report.overrides);
  const extraKeys = Object.keys(report.metrics)
    .filter((k) => !KNOWN_KEYS.has(k))
    .sort();

  return (
    <>
      <Topbar title="Auditor Dashboard" action={nav} />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        {/* Report header */}
        <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
              Report date
            </div>
            <div className="text-[16px] font-bold text-ink-900">{formatDate(report.date)}</div>
          </div>
          <span
            className="rounded-pill px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: sm.bg, color: sm.fg }}
          >
            {sm.label}
          </span>
          {report.submittedBy && (
            <div className="text-[11.5px] text-ink-500">
              Submitted by <span className="font-medium text-ink-700">{report.submittedBy}</span>
            </div>
          )}
          {report.approvedBy && (
            <div className="text-[11.5px] text-ink-500">
              Approved by <span className="font-medium text-ink-700">{report.approvedBy}</span>
            </div>
          )}
          {report.oldLeadsDueNextDay !== undefined && (
            <div className="text-[11.5px] text-ink-500">
              Old leads due next day{" "}
              <span className="font-semibold text-ink-800">{report.oldLeadsDueNextDay}</span>
            </div>
          )}
          {report.auditedFollowupScore !== undefined && (
            <div className="text-[11.5px] text-ink-500">
              Audited follow-up score{" "}
              <span className="font-semibold text-primary">{report.auditedFollowupScore}</span>
            </div>
          )}
          {overrides.size > 0 && (
            <div className="ml-auto text-[11px] text-warn">{overrides.size} overridden</div>
          )}
        </Card>

        {report.notes && (
          <Card className="mb-4 p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
              Auditor notes
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] text-ink-700">{report.notes}</p>
          </Card>
        )}

        <div className="space-y-5">
          {SECTIONS.map((section) => {
            const present = section.metrics.filter((m) => m.key in report.metrics);
            if (present.length === 0) return null;
            return (
              <section key={section.title}>
                <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">
                  {section.title}
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {present.map((m) => (
                    <MetricTile
                      key={m.key}
                      def={m}
                      value={report.metrics[m.key]}
                      overridden={overrides.has(m.key)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {extraKeys.length > 0 && (
            <section>
              <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">
                Additional metrics
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {extraKeys.map((k) => (
                  <MetricTile
                    key={k}
                    def={{ key: k, label: humanize(k), fmt: "int" }}
                    value={report.metrics[k]}
                    overridden={overrides.has(k)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
