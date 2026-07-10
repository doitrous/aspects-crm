import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { LeadDetail } from "@/components/lead/LeadDetail";
import { loadLeadDetail } from "@/lib/loadLeadDetail";

export const dynamic = "force-dynamic";

/**
 * Full-page lead detail — the fallback for a direct load / refresh / shared
 * link. When navigated to from the leads list, the intercepting route in
 * `@modal/(.)[id]` renders the same view as a slide-over drawer instead.
 */
export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadLeadDetail(id);
  if (!data) notFound();

  return (
    <>
      <Topbar
        title="Lead details"
        action={
          <div className="flex items-center gap-2">
            <Link
              href="/leads"
              className="rounded-control border border-line px-3 py-2 text-[12px] font-medium text-ink-600 hover:bg-line-faint"
            >
              ← Back
            </Link>
            <button className="rounded-control bg-primary px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-primary-hover">
              Reply
            </button>
          </div>
        }
      />
      <LeadDetail data={data} />
    </>
  );
}
