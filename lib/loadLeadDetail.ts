import {
  attributionFor,
  commentsFor,
  getLead,
  getLeads,
  messagesFor,
  leadTimeline,
  bookingsFor,
  escalationsFor,
  duplicatesFor,
} from "@/lib/data";
import type { LeadDetailData } from "@/components/lead/LeadDetail";
import { leadFinancials, type LeadFinancials } from "@/lib/data/financials";

/**
 * The financial record is the one part of the drawer that can be missing for a
 * reason other than "no data": the viewer may lack `financial.view`, the lead
 * may predate the financial tables, or migration `0007` may not have been
 * applied yet. None of those should take the whole lead detail down with them,
 * so a failure here degrades to `null` and the Payments tab explains itself.
 */
async function loadFinancials(id: string): Promise<LeadFinancials | null> {
  try {
    return await leadFinancials(id);
  } catch {
    return null;
  }
}

/**
 * Loads everything the lead detail view needs. Shared by the full-page route
 * (direct load / refresh) and the intercepted slide-over drawer so the two
 * never drift.
 */
export async function loadLeadDetail(id: string): Promise<LeadDetailData | null> {
  const lead = await getLead(id);
  if (!lead) return null;

  const [messages, comments, attribution, timeline, bookings, escalations, dupGroups, allLeads, financials] =
    await Promise.all([
      messagesFor(id),
      commentsFor(id),
      attributionFor(id),
      leadTimeline(id),
      bookingsFor(id),
      escalationsFor(id),
      duplicatesFor(id),
      getLeads(),
      loadFinancials(id),
    ]);

  const duplicateGroups = dupGroups.map((g) => ({
    ...g,
    members: g.leadIds
      .map((lid) => allLeads.find((l) => l.id === lid))
      .filter((l): l is NonNullable<typeof l> => Boolean(l))
      .map((l) => ({ id: l.id, name: l.patientName, phone: l.phone })),
  }));

  return {
    lead,
    messages,
    comments,
    attribution,
    timeline,
    bookings,
    escalations,
    duplicateGroups,
    financials,
  };
}
