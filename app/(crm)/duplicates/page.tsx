import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { DuplicateReviewList } from "@/components/queues/DuplicateReviewList";
import { duplicateQueuePage } from "@/lib/data";
import { PaginationNav } from "@/components/ui/PaginationNav";
import type { DuplicateQueueView } from "@/lib/types";

export const dynamic = "force-dynamic";

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[]; page?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: DuplicateQueueView = rawView === "resolved" ? "resolved" : "open";
  const result = await duplicateQueuePage(view, pageNumber(params.page), 30);
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hrefForPage = (page: number) => {
    const query = new URLSearchParams();
    if (view === "resolved") query.set("view", "resolved");
    if (page > 1) query.set("page", String(page));
    return query.size ? `/duplicates?${query}` : "/duplicates";
  };

  return (
    <>
      <Topbar title="Duplicates Review" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="mb-3 text-[11.5px] text-ink-400">
          {result.openTotal} to review · {result.resolvedTotal} resolved · showing up to 30 per page
        </div>

        <div className="mb-4 flex gap-2 border-b border-line-soft pb-3">
          <Link href="/duplicates" className={`rounded-control px-3 py-2 text-[12px] font-bold ${view === "open" ? "bg-primary text-white" : "border border-line text-ink-600"}`}>Needs review ({result.openTotal})</Link>
          <Link href="/duplicates?view=resolved" className={`rounded-control px-3 py-2 text-[12px] font-bold ${view === "resolved" ? "bg-primary text-white" : "border border-line text-ink-600"}`}>Resolved ({result.resolvedTotal})</Link>
        </div>

        {result.items.length === 0 ? (
          <EmptyState
            title={view === "open" ? "No duplicates need review" : "No resolved duplicate decisions"}
            hint={view === "open" ? "Suspected duplicates surface here automatically when non-empty identifiers match." : "Linked, merged, and dismissed pairs appear here."}
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
