import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { ReportsWorkspace } from "@/components/reports/ReportsWorkspace";
import { can } from "@/lib/auth/permissions";
import { summaryReports } from "@/lib/data";
import { moderatorScorecards, reportAutoData } from "@/lib/data/reporting";
import { requireSession } from "@/lib/data/session";

export const dynamic = "force-dynamic";

function day(v?: string) { return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10); }

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string; date?: string }> }) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "reports.view")) notFound();
  const sp = await searchParams;
  const date = day(sp.date);
  const [reports, auto, scorecards] = await Promise.all([
    summaryReports(), reportAutoData(date), can(user.role, "reports.generate") ? moderatorScorecards(date) : Promise.resolve([]),
  ]);
  return <><Topbar title="Reports Center" /><ReportsWorkspace reports={reports} selectedId={sp.id} date={date} auto={auto} scorecards={scorecards} role={user.role} /></>;
}
