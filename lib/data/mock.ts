import type {
  AuditReport,
  Booking,
  Comment,
  CrmSetting,
  DuplicateGroup,
  DuplicatePair,
  DuplicateQueueFilters,
  DuplicateQueueResult,
  DuplicateQueueView,
  Escalation,
  EscalationQueueItem,
  Lead,
  LeadAttribution,
  LeadSourceInfo,
  LeadSummary,
  Message,
  PipelineStage,
  SummaryReport,
  TimelineEvent,
} from "@/lib/types";
import { nestComments } from "@/lib/data/comments";
import { duplicateMatchesFilters } from "@/lib/data/duplicateFilters";
import { isDatabaseOnly, isDatabasePatientSource } from "@/lib/data/databasePatientVisibility";
import {
  NOW,
  bookings,
  duplicateGroups,
  escalations,
  leads,
  messages,
  timelineFor,
} from "@/lib/data/seed";
import type {
  DashboardMetrics,
  DataProvider,
  LeadFilters,
} from "@/lib/data/contracts";

function matchesSearch(lead: Lead, q: string): boolean {
  const hay = [lead.id, lead.mrn, lead.phone, lead.patientName, lead.chatLink, lead.platformId]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase().trim());
}

function filterLeads(filters: LeadFilters): Lead[] {
  return leads
    .filter((l) => {
      if (filters.q && !matchesSearch(l, filters.q)) return false;
      if (filters.excludeDatabasePatients && isDatabasePatientSource(l.sourceLabel)) return false;
      if (filters.excludeDatabaseOnly && isDatabaseOnly(l.databaseOnly)) return false;
      if (filters.stage && filters.stage !== "all" && l.stage !== filters.stage) return false;
      if (filters.platform && l.platform !== filters.platform) return false;
      if (filters.doctorId && l.doctorId !== filters.doctorId) return false;
      if (filters.specialtyId && l.specialtyId !== filters.specialtyId) return false;
      if (filters.sourceId && l.sourceId !== filters.sourceId) return false;
      if (filters.campaignId && l.campaignId !== filters.campaignId) return false;
      if (filters.escalated !== undefined && l.escalated !== filters.escalated) return false;
      if (filters.unread !== undefined && l.unread !== filters.unread) return false;
      if (filters.incomingUnanswered !== undefined && l.incomingUnanswered !== filters.incomingUnanswered) return false;
      if (filters.overdue !== undefined && l.overdue !== filters.overdue) return false;
      if (filters.duplicate && l.duplicateStatus !== "suspected") return false;
      if (filters.bookingStatus && l.bookingStatus !== filters.bookingStatus) return false;
      if (filters.moderator && l.assignedModerator !== filters.moderator) return false;
      return true;
    })
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.createdAt).getTime() -
        new Date(a.lastMessageAt ?? a.createdAt).getTime(),
    );
}

function toSummary(l: Lead): LeadSummary {
  return {
    id: l.id,
    uid: l.uid,
    name: l.patientName,
    phone: l.phone,
    stage: l.stage,
    platform: l.platform,
    createdAt: l.createdAt,
    serviceName: l.serviceName,
    serviceNames: l.serviceNames,
    doctorNames: l.doctorNames,
    assignedModerator: l.assignedModerator,
    databaseOnly: l.databaseOnly,
  };
}

function findLead(id: string): Lead | undefined {
  return leads.find((l) => l.id === id);
}

export const mockProvider: DataProvider = {
  now: () => NOW,

  async getLeads(filters: LeadFilters = {}): Promise<Lead[]> {
    return filterLeads(filters);
  },

  async getLead(id: string): Promise<Lead | undefined> {
    return leads.find((l) => l.id === id);
  },

  async messagesFor(leadId: string, channels?: Message["channel"][]): Promise<Message[]> {
    return messages
      .filter((m) => m.leadId === leadId && (!channels || channels.includes(m.channel)))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  async commentsFor(leadId: string): Promise<Comment[]> {
    // The seed keeps comments alongside messages; the live layer keeps them in
    // their own table. Both surface the same `Comment` shape.
    const flat: Comment[] = messages
      .filter((m) => m.leadId === leadId && m.channel === "comment")
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((m) => ({
        id: m.id,
        leadId,
        platform: m.postRef?.startsWith("IG") ? "instagram" : "facebook",
        commentId: m.id,
        threadRole: m.direction === "outgoing" ? "business_reply" : "top_level",
        isReply: false,
        isPageOrBusinessReply: m.direction === "outgoing",
        body: m.body,
        createdAt: m.createdAt,
        authorName: m.authorName,
        postId: m.postRef,
        isEdited: false,
        isDeleted: false,
        editCount: 0,
      }));
    return nestComments(flat);
  },

  async attributionFor(leadId: string): Promise<LeadAttribution | null> {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead?.campaignId) return null;
    return {
      leadId,
      firstSource: lead.platform,
      firstCampaign: lead.campaignId,
      firstTouchAt: lead.createdAt,
      latestSource: lead.platform,
      latestCampaign: lead.campaignId,
      latestTouchAt: lead.createdAt,
      touchCount: 1,
    };
  },

  async bookingsFor(leadId: string): Promise<Booking[]> {
    return bookings.filter((b) => b.leadId === leadId);
  },

  async escalationsFor(leadId: string): Promise<Escalation[]> {
    return escalations.filter((e) => e.leadId === leadId);
  },

  async duplicatesFor(leadId: string): Promise<DuplicateGroup[]> {
    return duplicateGroups.filter((g) => g.leadIds.includes(leadId));
  },

  async leadTimeline(leadId: string): Promise<TimelineEvent[]> {
    return timelineFor(leadId);
  },

  async dashboardMetrics(): Promise<DashboardMetrics> {
    const operationalIds = new Set(leads.filter((lead) => !lead.databaseOnly).map((lead) => lead.id));
    return {
      newLeads: leads.filter((l) => !l.databaseOnly && l.stage === "new" && !isDatabasePatientSource(l.sourceLabel)).length,
      unread: leads.filter((l) => !l.databaseOnly && l.unread).length,
      incomingUnanswered: leads.filter((l) => !l.databaseOnly && l.incomingUnanswered).length,
      overdue: leads.filter((l) => !l.databaseOnly && l.overdue).length,
      qualified: leads.filter((l) => !l.databaseOnly && l.stage === "qualified").length,
      booked: leads.filter((l) => !l.databaseOnly && l.stage === "booked").length,
      followUp: leads.filter((l) => !l.databaseOnly && l.stage === "follow_up").length,
      lost: leads.filter((l) => !l.databaseOnly && l.stage === "lost").length,
      duplicates: leads.filter((l) => !l.databaseOnly && l.duplicateStatus === "suspected").length,
      escalations: escalations.filter((e) => operationalIds.has(e.leadId) && e.status !== "resolved").length,
      unconfirmedAppts: bookings.filter((b) => b.status === "unconfirmed").length,
    };
  },

  async pipelineCounts(): Promise<Record<PipelineStage, number>> {
    const base: Record<PipelineStage, number> = {
      new: 0,
      qualified: 0,
      booked: 0,
      follow_up: 0,
      post_op: 0,
      lost: 0,
    };
    for (const l of leads) if (!l.databaseOnly) base[l.stage]++;
    return base;
  },

  async escalationQueue(): Promise<EscalationQueueItem[]> {
    return escalations
      .filter((escalation) => !findLead(escalation.leadId)?.databaseOnly)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((e) => {
        const lead = findLead(e.leadId);
        return { ...e, lead: lead ? toSummary(lead) : undefined };
      });
  },

  async duplicateQueue(): Promise<DuplicatePair[]> {
    return duplicateGroups.map((g) => {
      const primary = findLead(g.leadIds[0]);
      const duplicate = findLead(g.leadIds[1]);
      return {
        id: g.id,
        type: g.reason,
        confidence: g.confidence,
        status: g.status,
        createdAt: primary?.createdAt ?? NOW.toISOString(),
        primary: primary ? toSummary(primary) : undefined,
        duplicate: duplicate ? toSummary(duplicate) : undefined,
      };
    }).filter((pair) => !pair.primary?.databaseOnly && !pair.duplicate?.databaseOnly);
  },

  async duplicateQueuePage(
    view: DuplicateQueueView = "open",
    requestedPage = 1,
    requestedPageSize = 30,
    filters?: DuplicateQueueFilters,
  ): Promise<DuplicateQueueResult> {
    const all = await this.duplicateQueue();
    const filtered = all.filter((pair) => duplicateMatchesFilters(pair, filters));
    const open = filtered.filter((pair) => pair.status === "suspected");
    const resolved = filtered.filter((pair) => pair.status !== "suspected");
    const selected = view === "open" ? open : resolved;
    const pageSize = Math.min(30, Math.max(1, Math.floor(requestedPageSize)));
    const page = Math.max(1, Math.floor(requestedPage));
    const from = (page - 1) * pageSize;
    return {
      items: selected.slice(from, from + pageSize),
      total: selected.length,
      openTotal: open.length,
      resolvedTotal: resolved.length,
      page,
      pageSize,
      view,
    };
  },

  async followUpQueue(stage?: "follow_up" | "post_op", requestedPage = 1, requestedPageSize = 30) {
    const now = NOW.getTime();
    const all = leads
      .filter((l) => !l.databaseOnly && (stage ? l.stage === stage : l.stage === "follow_up" || l.stage === "post_op"))
      .map((l) => {
        const dueAt = l.followUp.nextDate;
        return {
          lead: toSummary(l),
          workflowType: l.stage === "post_op" ? "post_op" : "standard",
          dueAt,
          reason: l.followUp.reason,
          status: l.followUp.status === "none" ? "pending" : l.followUp.status,
          lastContactAt: l.followUp.lastContact,
          overdue: dueAt ? new Date(dueAt).getTime() < now : false,
        };
      });
    const pageSize = Math.min(100, Math.max(1, Math.floor(requestedPageSize)));
    const page = Math.max(1, Math.floor(requestedPage));
    const from = (page - 1) * pageSize;
    return { items: all.slice(from, from + pageSize), total: all.length, page, pageSize };
  },

  async auditorReport(): Promise<AuditReport | null> {
    // No seeded audit reports offline; auditor runs on live data.
    return null;
  },

  async auditorReportDates(): Promise<string[]> {
    return [];
  },

  async resolveDuplicate(): Promise<void> {
    // Offline seed is read-only.
  },

  async resolveEscalation(): Promise<void> {
    // Offline seed is read-only.
  },

  async summaryReports(): Promise<SummaryReport[]> {
    // Generated narrative reports live on the server; none seeded offline.
    return [];
  },

  async crmSettings(): Promise<CrmSetting[]> {
    return [];
  },

  async leadSourcesList(): Promise<LeadSourceInfo[]> {
    return [
      { id: "facebook", key: "facebook_messenger", label: "Facebook Messenger", sourceType: "social", active: true },
      { id: "instagram", key: "instagram", label: "Instagram", sourceType: "social", active: true },
      { id: "whatsapp", key: "whatsapp", label: "WhatsApp", sourceType: "messaging", active: true },
      { id: "manual", key: "manual", label: "Manual entry", sourceType: "manual", active: true },
    ];
  },
};
