import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { dashboardMetrics, pipelineCounts } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { NOW } from "@/lib/data";
import { PipelineSummary } from "@/components/dashboard/PipelineSummary";

interface Kpi {
  key: string;
  label: string;
  value: number;
  href: string;
  tone: "danger" | "warn" | "info" | "neutral";
  hint?: string;
}

const TONE: Record<Kpi["tone"], { bg: string; fg: string; ring: string }> = {
  danger: { bg: "#fef3f2", fg: "#b42318", ring: "#fecdca" },
  warn: { bg: "#fffaeb", fg: "#b54708", ring: "#fedf89" },
  info: { bg: "#eff4ff", fg: "#175cd3", ring: "#b2ccff" },
  neutral: { bg: "#f9fafb", fg: "#344054", ring: "#e4e7ec" },
};

export default async function DashboardPage() {
  const [m, p] = await Promise.all([dashboardMetrics(), pipelineCounts()]);

  const kpis: Kpi[] = [
    { key: "newLeads", label: "New Leads", value: m.newLeads, href: "/leads?stage=new", tone: "info" },
    { key: "unread", label: "Unread Leads", value: m.unread, href: "/leads?unread=1", tone: "info" },
    { key: "incoming", label: "Incoming Unanswered", value: m.incomingUnanswered, href: "/leads?incoming=1", tone: "warn" },
    { key: "overdue", label: "Overdue Replies", value: m.overdue, href: "/leads?overdue=1", tone: "danger" },
    { key: "qualified", label: "Qualified", value: m.qualified, href: "/leads?stage=qualified", tone: "neutral" },
    { key: "followUp", label: "Follow-Up", value: m.followUp, href: "/leads?stage=follow_up", tone: "warn" },
    { key: "duplicates", label: "Duplicates", value: m.duplicates, href: "/duplicates", tone: "warn" },
    { key: "escalations", label: "Escalations", value: m.escalations, href: "/escalations", tone: "danger" },
    { key: "appts", label: "Unconfirmed Appointments", value: m.unconfirmedAppts, href: "/calendar?status=unconfirmed", tone: "warn" },
  ];

  return (
    <>
      <Topbar title="CRM Dashboard" overdue={m.overdue} unread={m.unread} />
      <div className="flex-1 overflow-auto bg-canvas/40 px-[18px] py-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-[18px] font-semibold text-clinic-ink">
            Operational overview
          </h2>
          <span className="text-[11.5px] text-ink-400">
            As of {formatDate(NOW)}
          </span>
        </div>

        {/* Operational KPI cards — clickable, filter the leads list */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-3">
          {kpis.map((k) => {
            const t = TONE[k.tone];
            return (
              <Link
                key={k.key}
                href={k.href}
                className="group rounded-card border border-line bg-panel p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40"
              >
                <div className="flex items-start justify-between">
                  <span className="text-[12px] font-medium text-ink-500">
                    {k.label}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    view →
                  </span>
                </div>
                <div
                  className="mt-2 text-[28px] font-bold leading-none"
                  style={{ color: t.fg }}
                >
                  {k.value}
                </div>
              </Link>
            );
          })}
        </div>

        <PipelineSummary counts={p} className="mt-7" />
      </div>
    </>
  );
}
