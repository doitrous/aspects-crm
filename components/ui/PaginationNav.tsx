export function PaginationNav({
  page,
  pageCount,
  hrefForPage,
  summary,
}: {
  page: number;
  pageCount: number;
  hrefForPage: (page: number) => string;
  summary?: string;
}) {
  if (pageCount <= 1) return null;

  const linkClass =
    "inline-flex min-w-[82px] items-center justify-center rounded-control border px-3 py-2 text-[12px] font-bold shadow-sm transition";

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-y border-line-soft bg-toolbar/60 px-[18px] py-2.5">
      <span className="me-auto text-[11.5px] font-medium text-ink-500">
        {summary ?? `Page ${page} of ${pageCount}`}
      </span>
      <a
        href={hrefForPage(Math.max(1, page - 1))}
        aria-disabled={page <= 1}
        className={`${linkClass} border-primary/30 bg-panel text-primary ${page <= 1 ? "pointer-events-none opacity-40" : "hover:border-primary hover:bg-primary-soft"}`}
      >
        Previous
      </a>
      <a
        href={hrefForPage(Math.min(pageCount, page + 1))}
        aria-disabled={page >= pageCount}
        className={`${linkClass} border-primary bg-primary text-white ${page >= pageCount ? "pointer-events-none opacity-40" : "hover:bg-primary-hover"}`}
      >
        Next
      </a>
    </div>
  );
}
