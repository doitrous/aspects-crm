export default function CrmLoading() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" role="status" aria-live="polite" aria-label="Loading page">
      <div className="flex min-h-[56px] items-center border-b border-line-soft px-[18px]">
        <div className="h-5 w-36 animate-pulse rounded bg-line motion-reduce:animate-none" />
      </div>
      <div className="grid flex-1 gap-4 overflow-hidden p-[18px] md:grid-cols-3">
        <div className="h-28 animate-pulse rounded-card bg-line-faint motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-card bg-line-faint motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-card bg-line-faint motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-card bg-line-faint motion-reduce:animate-none md:col-span-3" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
