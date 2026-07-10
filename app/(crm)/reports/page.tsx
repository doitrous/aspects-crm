import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { summaryReports } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { SummaryReport } from "@/lib/types";

export const dynamic = "force-dynamic";

const TYPE_META: Record<string, { label: string; bg: string; fg: string }> = {
  auditor_clinic_daily_ar: { label: "Auditor · Daily", bg: "#eef2ff", fg: "#4338ca" },
  moderator_daily_ar: { label: "Moderator · Daily", bg: "#ecfdf3", fg: "#067647" },
};

function typeMeta(t: string) {
  return (
    TYPE_META[t] ?? {
      label: t.replace(/_ar$/, "").replace(/_/g, " "),
      bg: "#f2f4f7",
      fg: "#475467",
    }
  );
}

const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: "#f2f4f7", fg: "#475467" },
  final: { label: "Final", bg: "#ecfdf3", fg: "#067647" },
  approved: { label: "Approved", bg: "#ecfdf3", fg: "#067647" },
};

function ReportRow({ r, active }: { r: SummaryReport; active: boolean }) {
  const tm = typeMeta(r.reportType);
  return (
    <Link
      href={`/reports?id=${r.id}`}
      className={
        "block rounded-control border px-3 py-2.5 transition-colors " +
        (active
          ? "border-primary/50 bg-primary-soft/40"
          : "border-line-soft bg-panel hover:border-primary/30 hover:bg-line-faint/50")
      }
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
          style={{ background: tm.bg, color: tm.fg }}
        >
          {tm.label}
        </span>
        {r.status !== "final" && r.status !== "approved" && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-400">
            {r.status}
          </span>
        )}
      </div>
      <div className="mt-1 text-[13px] font-semibold text-ink-900">{formatDate(r.reportDate)}</div>
    </Link>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const reports = await summaryReports();
  const selected = reports.find((r) => r.id === id) ?? reports[0];

  if (reports.length === 0) {
    return (
      <>
        <Topbar title="Reports" />
        <div className="flex-1 overflow-auto">
          <EmptyState
            title="No reports generated yet"
            hint="Daily auditor and moderator summaries appear here once the reporting job runs."
          />
        </div>
      </>
    );
  }

  const sm = selected ? STATUS_META[selected.status] ?? STATUS_META.draft : undefined;

  return (
    <>
      <Topbar title="Reports" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          {/* Report index */}
          <aside className="space-y-2">
            <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
              {reports.length} report{reports.length === 1 ? "" : "s"}
            </div>
            {reports.map((r) => (
              <ReportRow key={r.id} r={r} active={selected?.id === r.id} />
            ))}
          </aside>

          {/* Selected report body */}
          {selected && (
            <Card className="flex flex-col overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3">
                <div className="text-[15px] font-bold text-ink-900">
                  {typeMeta(selected.reportType).label}
                </div>
                <span className="text-[12px] text-ink-500">{formatDate(selected.reportDate)}</span>
                {sm && (
                  <span
                    className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: sm.bg, color: sm.fg }}
                  >
                    {sm.label}
                  </span>
                )}
                {selected.generatedBy && (
                  <span className="ml-auto text-[11.5px] text-ink-400">
                    by {selected.generatedBy}
                  </span>
                )}
              </div>
              {/* dir="auto" lets Arabic bodies render RTL and Latin bodies LTR. */}
              <pre
                dir="auto"
                className="max-h-[calc(100vh-220px)] overflow-auto whitespace-pre-wrap px-4 py-4 font-sans text-[13px] leading-relaxed text-ink-800"
              >
                {selected.text || "— empty report —"}
              </pre>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
