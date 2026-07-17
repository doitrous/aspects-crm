import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { DuplicateReviewList } from "@/components/queues/DuplicateReviewList";
import { duplicateQueuePage } from "@/lib/data";
import { PaginationNav } from "@/components/ui/PaginationNav";
import { normalizeDuplicateFilters } from "@/lib/data/duplicateFilters";
import type { DuplicateQueueView, DuplicateSearchField } from "@/lib/types";

export const dynamic = "force-dynamic";

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function searchField(value: string | string[] | undefined): DuplicateSearchField {
  const candidate = first(value);
  return ["name", "phone", "mrn", "lead_id", "platform_id"].includes(candidate) ? candidate as DuplicateSearchField : "all";
}

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; page?: string | string[]; q?: string | string[]; field?: string | string[]; matchType?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawView = first(params.view);
  const view: DuplicateQueueView = rawView === "resolved" ? "resolved" : "open";
  const filters = normalizeDuplicateFilters({ q: first(params.q), field: searchField(params.field), matchType: first(params.matchType) });
  const filtering = Boolean(filters.q || filters.matchType);
  const result = await duplicateQueuePage(view, pageNumber(params.page), 30, filters);
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hrefFor = (targetView: DuplicateQueueView, page = 1) => {
    const query = new URLSearchParams();
    if (targetView === "resolved") query.set("view", "resolved");
    if (filters.q) query.set("q", filters.q);
    if (filters.field !== "all") query.set("field", filters.field);
    if (filters.matchType) query.set("matchType", filters.matchType);
    if (page > 1) query.set("page", String(page));
    return query.size ? `/duplicates?${query}` : "/duplicates";
  };
  const hrefForPage = (page: number) => hrefFor(view, page);

  return (
    <>
      <Topbar title="Duplicates Review" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="mb-3 text-[11.5px] text-ink-400">
          {result.openTotal} {filtering ? "matching " : ""}to review · {result.resolvedTotal} {filtering ? "matching " : ""}resolved · showing up to 30 per page
        </div>

        <div className="mb-4 flex gap-2 border-b border-line-soft pb-3">
          <Link href={hrefFor("open")} className={`rounded-control px-3 py-2 text-[12px] font-bold ${view === "open" ? "bg-primary text-white" : "border border-line text-ink-600"}`}>Needs review ({result.openTotal})</Link>
          <Link href={hrefFor("resolved")} className={`rounded-control px-3 py-2 text-[12px] font-bold ${view === "resolved" ? "bg-primary text-white" : "border border-line text-ink-600"}`}>Resolved ({result.resolvedTotal})</Link>
        </div>

        <form method="get" className="mb-4 grid gap-2 rounded-card border border-line bg-panel p-3 shadow-card sm:grid-cols-[minmax(220px,1fr)_170px_170px_auto_auto] sm:items-end">
          {view === "resolved" && <input type="hidden" name="view" value="resolved" />}
          <label className="grid gap-1 text-[11px] font-bold text-ink-500">Search duplicates<input name="q" defaultValue={filters.q} placeholder="Name, phone, MRN, lead number…" className="h-10 rounded-control border border-line bg-white px-3 text-[13px] font-medium text-ink-800 outline-none focus:border-primary" /></label>
          <label className="grid gap-1 text-[11px] font-bold text-ink-500">Search field<select name="field" defaultValue={filters.field} className="h-10 rounded-control border border-line bg-white px-3 text-[12px] font-semibold text-ink-700 outline-none focus:border-primary"><option value="all">All identifiers</option><option value="name">Patient name</option><option value="phone">Phone number</option><option value="mrn">MRN</option><option value="lead_id">Lead number</option><option value="platform_id">Platform ID</option></select></label>
          <label className="grid gap-1 text-[11px] font-bold text-ink-500">Matched on<select name="matchType" defaultValue={filters.matchType} className="h-10 rounded-control border border-line bg-white px-3 text-[12px] font-semibold text-ink-700 outline-none focus:border-primary"><option value="">All match types</option><option value="mrn">MRN</option><option value="lead_id">Lead ID</option><option value="phone">Phone number</option><option value="platform_id">Platform ID</option><option value="unique_id">Unique ID</option><option value="chat_link">Chat link</option><option value="name">Three-part name</option></select></label>
          <button type="submit" className="h-10 rounded-control bg-primary px-4 text-[12px] font-bold text-white hover:bg-primary-hover">Apply filters</button>
          {filtering && <Link href={view === "resolved" ? "/duplicates?view=resolved" : "/duplicates"} className="inline-flex h-10 items-center justify-center rounded-control border border-line px-3 text-[12px] font-bold text-ink-600 hover:bg-line-faint">Clear</Link>}
        </form>

        {result.items.length === 0 ? (
          <EmptyState
            title={filtering ? "No duplicates match these filters" : view === "open" ? "No duplicates need review" : "No resolved duplicate decisions"}
            hint={filtering ? "Try another identifier, search field, or match type." : view === "open" ? "Suspected duplicates surface here automatically when non-empty identifiers match." : "Linked, merged, and dismissed pairs appear here."}
          />
        ) : (
          <>
            <PaginationNav page={result.page} pageCount={pageCount} hrefForPage={hrefForPage} />
            <DuplicateReviewList items={result.items} view={view} />
            <PaginationNav page={result.page} pageCount={pageCount} hrefForPage={hrefForPage} />
          </>
        )}
      </div>
    </>
  );
}
