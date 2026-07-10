import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/lead/LeadDetail";
import { loadLeadDetail } from "@/lib/loadLeadDetail";

export const dynamic = "force-dynamic";

/**
 * Full-page lead detail — the fallback for a direct load / refresh / shared
 * link. When navigated to from the leads list, the intercepting route in
 * `@modal/(.)[id]` renders the same view as a slide-over drawer instead.
 * LeadDetail renders its own header (with a close control back to /leads).
 */
export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadLeadDetail(id);
  if (!data) notFound();

  return <LeadDetail data={data} />;
}
