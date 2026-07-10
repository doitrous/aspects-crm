import { Suspense } from "react";
import { Topbar } from "@/components/shell/Topbar";
import { LeadsToolbar } from "@/components/leads/LeadsToolbar";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { NewLeadButton } from "@/components/leads/NewLeadButton";
import { getLeads, dashboardMetrics, leadSourcesList, NOW, type LeadFilters } from "@/lib/data";
import type { PipelineStage } from "@/lib/types";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const channel = str(sp.channel);

  const filters: LeadFilters = {
    q: str(sp.q),
    stage: (str(sp.stage) as PipelineStage | undefined) ?? "all",
    platform: channel?.startsWith("platform:") ? channel.slice("platform:".length) : str(sp.platform),
    doctorId: str(sp.doctor),
    specialtyId: str(sp.specialty),
    sourceId: channel?.startsWith("source:") ? channel.slice("source:".length) : str(sp.source),
    campaignId: str(sp.campaign),
    dateFrom: str(sp.dateFrom),
    dateTo: str(sp.dateTo),
    escalated: str(sp.escalated) === "1" ? true : undefined,
    unread: str(sp.unread) === "1" ? true : undefined,
    incomingUnanswered: str(sp.incoming) === "1" ? true : undefined,
    overdue: str(sp.overdue) === "1" ? true : undefined,
    duplicate: str(sp.duplicate) === "1" ? true : undefined,
    bookingStatus: str(sp.booking),
  };

  const [leads, m, sources] = await Promise.all([getLeads(filters), dashboardMetrics(), leadSourcesList()]);

  return (
    <>
      <Topbar
        title="New Leads"
        search="Search name, phone, MRN…"
        overdue={m.overdue}
        unread={m.unread}
        action={<NewLeadButton sources={sources} />}
      />
      <Suspense fallback={null}>
        <LeadsToolbar sources={sources} />
      </Suspense>
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          {leads.length} lead{leads.length === 1 ? "" : "s"}
        </div>
        <LeadsTable leads={leads} now={NOW.toISOString()} />
      </div>
    </>
  );
}
