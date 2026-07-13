import { Suspense } from "react";
import { Topbar } from "@/components/shell/Topbar";
import { LeadsToolbar } from "@/components/leads/LeadsToolbar";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { getLeadsPage, leadSourcesList, NOW, type LeadFilters } from "@/lib/data";
import type { PipelineStage } from "@/lib/types";
import { financialDoctorCatalog } from "@/lib/booking/service";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { DeleteAllLeadsButton } from "@/components/leads/LeadDeletionControls";
import { requireSession } from "@/lib/data/session";
import { can } from "@/lib/auth/permissions";
import { bookingConfigured } from "@/lib/booking/client";
import { getReservations } from "@/lib/booking/reservations";
import { syncReservationsToLeads } from "@/lib/booking/sync";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function pageNumber(v: string | string[] | undefined): number {
  const n = Number.parseInt(str(v) ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function syncWebsiteReservationsIntoDatabase(): Promise<void> {
  if (!bookingConfigured()) return;
  try {
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - 90);
    const reservations = await getReservations({ from: from.toISOString().slice(0, 10) });
    await syncReservationsToLeads(reservations);
  } catch (error) {
    // The local patient database must remain usable during a booking-platform
    // outage. The next Database/Calendar/Reservations request will retry.
    console.error("website reservation database sync failed", error);
  }
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const { effective: user } = await requireSession();
  const canDelete = can(user.role, "leads.delete");
  await syncWebsiteReservationsIntoDatabase();
  const channel = str(sp.channel);
  const filters: LeadFilters = {
    q: str(sp.q),
    stage: (str(sp.stage) as PipelineStage | undefined) ?? "all",
    platform: channel?.startsWith("platform:") ? channel.slice("platform:".length) : str(sp.platform),
    sourceId: channel?.startsWith("source:") ? channel.slice("source:".length) : str(sp.source),
    doctorId: str(sp.doctor),
    specialtyId: str(sp.specialty),
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
  const [leadPage, sources, catalog] = await Promise.all([getLeadsPage(filters), leadSourcesList(), financialDoctorCatalog()]);
  const { leads, total, page, pageSize } = leadPage;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageHref = (nextPage: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(sp)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (first && key !== "page") params.set(key, first);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/database?${qs}` : "/database";
  };

  return (
    <>
      <Topbar title="Database" action={canDelete?<DeleteAllLeadsButton total={total}/>:undefined} />
      <Suspense fallback={null}>
        <LeadsToolbar sources={sources} doctors={catalog.doctors.map((d) => ({ id: d.id, name: d.nameEn }))} specialties={catalog.specialties.map((s) => ({ id: s.id, name: s.nameEn }))} basePath="/database" />
      </Suspense>
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          {`Showing ${leads.length} of ${total} leads · page ${page} / ${pageCount}`}
        </div>
        <PaginationNav page={page} pageCount={pageCount} hrefForPage={pageHref} />
        <LeadsTable leads={leads} now={NOW.toISOString()} canDelete={canDelete} />
        <PaginationNav page={page} pageCount={pageCount} hrefForPage={pageHref} />
      </div>
    </>
  );
}
