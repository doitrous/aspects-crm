import { Suspense } from "react";
import { Topbar } from "@/components/shell/Topbar";
import { LeadsToolbar } from "@/components/leads/LeadsToolbar";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { getLeadsPage, dashboardMetrics, leadSourcesList, NOW, type LeadFilters } from "@/lib/data";
import { financialDoctorCatalog } from "@/lib/booking/service";
import type { PipelineStage } from "@/lib/types";
import { PaginationNav } from "@/components/ui/PaginationNav";

type SP = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pageNumber(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(first(value) ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export async function StageLeadsPage({
  searchParams,
  stage,
  title,
  basePath,
}: {
  searchParams: Promise<SP>;
  stage: PipelineStage;
  title: string;
  basePath: string;
}) {
  const sp = await searchParams;
  const channel = first(sp.channel);
  const filters: LeadFilters = {
    q: first(sp.q),
    stage,
    excludeDatabaseOnly: true,
    platform: channel?.startsWith("platform:") ? channel.slice(9) : first(sp.platform),
    sourceId: channel?.startsWith("source:") ? channel.slice(7) : first(sp.source),
    campaignId: first(sp.campaign),
    doctorId: first(sp.doctor),
    specialtyId: first(sp.specialty),
    dateFrom: first(sp.dateFrom),
    dateTo: first(sp.dateTo),
    unread: first(sp.unread) === "1" ? true : undefined,
    escalated: first(sp.escalated) === "1" ? true : undefined,
    overdue: first(sp.overdue) === "1" ? true : undefined,
    duplicate: first(sp.duplicate) === "1" ? true : undefined,
    page: pageNumber(sp.page),
    pageSize: 30,
  };
  const [leadPage, metrics, sources, catalog] = await Promise.all([
    getLeadsPage(filters),
    dashboardMetrics(),
    leadSourcesList(),
    financialDoctorCatalog(),
  ]);
  const pageCount = Math.max(1, Math.ceil(leadPage.total / leadPage.pageSize));
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      const item = first(value);
      if (item && key !== "page" && key !== "stage") params.set(key, item);
    }
    if (page > 1) params.set("page", String(page));
    return params.size ? `${basePath}?${params}` : basePath;
  };

  return (
    <>
      <Topbar title={title} overdue={metrics.overdue} unread={metrics.unread} />
      <Suspense fallback={null}>
        <LeadsToolbar
          sources={sources}
          doctors={catalog.doctors.map((doctor) => ({ id: doctor.id, name: doctor.nameEn }))}
          specialties={catalog.specialties.map((specialty) => ({ id: specialty.id, name: specialty.nameEn }))}
          basePath={basePath}
          stageLocked
        />
      </Suspense>
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          {`Showing ${leadPage.leads.length} of ${leadPage.total} leads · page ${leadPage.page} / ${pageCount}`}
        </div>
        <PaginationNav page={leadPage.page} pageCount={pageCount} hrefForPage={pageHref} />
        <LeadsTable leads={leadPage.leads} now={NOW.toISOString()} />
        <PaginationNav page={leadPage.page} pageCount={pageCount} hrefForPage={pageHref} />
      </div>
    </>
  );
}
