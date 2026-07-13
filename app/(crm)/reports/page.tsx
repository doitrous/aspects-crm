import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { ReportsWorkspace } from "@/components/reports/ReportsWorkspace";
import { can } from "@/lib/auth/permissions";
import { summaryReports } from "@/lib/data";
import { emptyReportAutoData, moderatorScorecards, reportAutoData } from "@/lib/data/reporting";
import { requireSession } from "@/lib/data/session";

export const dynamic = "force-dynamic";

function day(v?: string) { return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10); }

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string; date?: string }> }) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "reports.view")) notFound();
  const sp = await searchParams;
  const date = day(sp.date);
  const failures: string[] = [];
  const [reports, auto, scorecards] = await Promise.all([
    summaryReports().catch((error) => { console.error("reports list failed", error); failures.push("saved reports"); return []; }),
    reportAutoData(date).catch((error) => { console.error("report calculation failed", error); failures.push("automatic calculations"); return emptyReportAutoData(date); }),
    can(user.role, "reports.generate") ? moderatorScorecards(date).catch((error) => { console.error("scorecards failed", error); failures.push("moderator scores"); return []; }) : Promise.resolve([]),
  ]);
  return <><Topbar title="Reports Center" /><ReportsWorkspace reports={reports} selectedId={sp.id} date={date} auto={auto} scorecards={scorecards} role={user.role} warning={failures.length ? `Some report data could not be loaded (${failures.join(", ")}). Load the date again after the data source is available.` : undefined} /></>;
}
