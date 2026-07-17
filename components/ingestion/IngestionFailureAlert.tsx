import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { IngestionFailureSetting } from "@/lib/data/settingsData";

export function IngestionFailureAlert({ failures, detailsHref }: { failures: IngestionFailureSetting[]; detailsHref?: string }) {
  const unresolved = failures.filter((failure) => !failure.recovered);
  if (!unresolved.length) return null;
  return (
    <section role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-[14px] font-black">{unresolved.length} ingestion failure{unresolved.length === 1 ? "" : "s"} require review</div><p className="mt-1 text-[12px] text-red-800">The webhook returned an error so the sender can retry. Successful events in the same batch remain safely registered.</p></div>
        {detailsHref && <Link href={detailsHref} className="inline-flex min-h-9 items-center rounded-control border border-red-300 bg-white px-3 text-[12px] font-bold text-red-800">Open ingestion log</Link>}
      </div>
      <div className="mt-3 space-y-2">
        {unresolved.slice(0, 5).map((failure) => <div key={failure.id} className="rounded-lg border border-red-200/80 bg-white/75 px-3 py-2 text-[11.5px]"><div className="font-bold">{formatDateTime(failure.createdAt)} · {failure.platform ?? "unknown platform"} · {failure.eventType ?? "event"} · {failure.direction ?? "unknown direction"}</div><div className="mt-1 break-words text-red-800">{failure.errors.join(" · ") || "No error detail was recorded."}</div></div>)}
      </div>
    </section>
  );
}
