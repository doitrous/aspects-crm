import { notFound } from "next/navigation";
import { LeadModal } from "@/components/lead/LeadModal";
import { loadLeadDetail } from "@/lib/loadLeadDetail";

export const dynamic = "force-dynamic";

/**
 * Intercepted lead detail — rendered as a slide-over drawer over the leads
 * list. A hard refresh / direct link falls through to the full-page route at
 * `leads/[id]`. Both share `loadLeadDetail` so the views never drift.
 */
export default async function LeadModalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await loadLeadDetail(id);
  if (!data) notFound();

  return <LeadModal data={data} />;
}
