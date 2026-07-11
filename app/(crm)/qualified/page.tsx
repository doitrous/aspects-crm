import { Suspense } from "react";
import { Topbar } from "@/components/shell/Topbar";
import { LeadsToolbar } from "@/components/leads/LeadsToolbar";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { getLeadsPage, dashboardMetrics, leadSourcesList, NOW, type LeadFilters } from "@/lib/data";
import { financialDoctorCatalog } from "@/lib/booking/service";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pageNumber(v: string | string[] | undefined): number {
  const n = Number.parseInt(str(v) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export default async function QualifiedLeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const channel = str(sp.channel);
  const filters: LeadFilters = {
    q: str(sp.q),
    stage: "qualified",
    platform: channel?.startsWith("platform:") ? channel.slice("platform:".length) : str(sp.platform),
    doctorId: str(sp.doctor),
    specialtyId: str(sp.specialty),
    sourceId: channel?.startsWith("source:") ? channel.slice("source:".length) : str(sp.source),
    campaignId: str(sp.campaign),
    dateFrom: str(sp.dateFrom),
    dateTo: str(sp.dateTo),
    escalated: str(sp.escalated) === "1" ? true : undefined,
    unread: str(sp.unread) === "1" ? true : undefined,
    overdue: str(sp.overdue) === "1" ? true : undefined,
    duplicate: str(sp.duplicate) === "1" ? true : undefined,
    page: pageNumber(sp.page),
    pageSize: 30,
  };

  const [leadPage, m, sources, catalog] = await Promise.all([getLeadsPage(filters), dashboardMetrics(), leadSourcesList(), financialDoctorCatalog()]);
  const { leads, total, page, pageSize } = leadPage;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first && key !== "page" && key !== "stage") params.set(key, first);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/qualified?${qs}` : "/qualified";
  };

  return (
    <>
      <Topbar title="Qualified Leads" overdue={m.overdue} unread={m.unread} />
      <Suspense fallback={null}>
        <LeadsToolbar sources={sources} doctors={catalog.doctors.map((d) => ({ id: d.id, name: d.nameEn }))} specialties={catalog.specialties.map((s) => ({ id: s.id, name: s.nameEn }))} basePath="/qualified" stageLocked />
      </Suspense>
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          {`Showing ${leads.length} of ${total} leads · page ${page} / ${pageCount}`}
        </div>
        <LeadsTable leads={leads} now={NOW.toISOString()} />
        <div className="flex items-center justify-end gap-2 px-[18px] py-3 text-[12px]">
          <a href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} className={`rounded-control border border-line px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:border-primary hover:text-primary"}`}>Previous</a>
          <a href={pageHref(Math.min(pageCount, page + 1))} aria-disabled={page >= pageCount} className={`rounded-control border border-line px-3 py-1.5 ${page >= pageCount ? "pointer-events-none opacity-40" : "hover:border-primary hover:text-primary"}`}>Next</a>
        </div>
      </div>
    </>
  );
}
