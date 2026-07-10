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
import { activeLeadTags, activeLostReasons } from "@/lib/data/leadMutations";
import { bookingCatalog } from "@/lib/booking/service";

/**
 * The financial record is the one part of the drawer that can be missing for a
 * reason other than "no data": the viewer may lack `financial.view`, the lead
 * may predate the financial tables, or migration `0007` may not have been
 * applied yet. None of those should take the whole lead detail down with them,
 * but the reason must not be swallowed; the Payments tab needs the real error
 * so production schema/RLS/env failures are visible instead of looking empty.
 */
async function loadFinancials(id: string): Promise<{ financials: LeadFinancials | null; error: string | null }> {
  try {
    return { financials: await leadFinancials(id), error: null };
  } catch (error) {
    return {
      financials: null,
      error: error instanceof Error ? error.message : "Financial records could not be loaded.",
    };
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

  const [
    messages,
    comments,
    attribution,
    timeline,
    bookings,
    escalations,
    dupGroups,
    allLeads,
    financialResult,
    availableTags,
    lostReasons,
    catalog,
  ] =
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
      activeLeadTags(),
      activeLostReasons(),
      bookingCatalog(),
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
    financials: financialResult.financials,
    financialsError: financialResult.error,
    availableTags,
    lostReasons,
    bookingCatalog: catalog,
  };
}
