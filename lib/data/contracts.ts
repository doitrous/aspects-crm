import type {
  AuditReport,
  Booking,
  Comment,
  CrmSetting,
  DuplicateDecision,
  DuplicateGroup,
  DuplicatePair,
  Escalation,
  EscalationQueueItem,
  FollowUpItem,
  Lead,
  LeadAttribution,
  LeadSourceInfo,
  Message,
  PipelineStage,
  SummaryReport,
  TimelineEvent,
} from "@/lib/types";

/** Filters accepted by the leads list + dashboard deep-links. */
export interface LeadFilters {
  q?: string; // search: id, mrn, phone, name, chat link, platform id
  stage?: PipelineStage | "all";
  stages?: PipelineStage[];
  platform?: string;
  doctorId?: string;
  specialtyId?: string;
  sourceId?: string;
  campaignId?: string;
  dateFrom?: string;
  dateTo?: string;
  escalated?: boolean;
  unread?: boolean;
  incomingUnanswered?: boolean;
  overdue?: boolean;
  duplicate?: boolean;
  bookingStatus?: string;
  moderator?: string;
  page?: number;
  pageSize?: number;
}

export interface LeadListResult {
  leads: Lead[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FollowUpListResult {
  items: FollowUpItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Operational KPI counts for the moderator dashboard cards. */
export interface DashboardMetrics {
  newLeads: number;
  unread: number;
  incomingUnanswered: number;
  overdue: number;
  qualified: number;
  booked: number;
  followUp: number;
  lost: number;
  duplicates: number;
  escalations: number;
  unconfirmedAppts: number;
}

/**
 * The single contract both the mock seed layer and the live Supabase adapter
 * implement. Everything is async so the two are interchangeable behind
 * `lib/data/index.ts` (selected by `CRM_DATA_SOURCE`).
 */
export interface DataProvider {
  now(): Date;
  getLeads(filters?: LeadFilters): Promise<Lead[]>;
  getLeadsPage?(filters?: LeadFilters): Promise<LeadListResult>;
  getLead(id: string): Promise<Lead | undefined>;
  messagesFor(leadId: string, channels?: Message["channel"][]): Promise<Message[]>;
  /** Comments live in their own table; Messenger/WhatsApp threads never contain them. */
  commentsFor(leadId: string): Promise<Comment[]>;
  /** First-/latest-touch ad attribution, or `null` for a lead with no referral. */
  attributionFor(leadId: string): Promise<LeadAttribution | null>;
  bookingsFor(leadId: string): Promise<Booking[]>;
  escalationsFor(leadId: string): Promise<Escalation[]>;
  duplicatesFor(leadId: string): Promise<DuplicateGroup[]>;
  leadTimeline(leadId: string): Promise<TimelineEvent[]>;
  dashboardMetrics(): Promise<DashboardMetrics>;
  pipelineCounts(): Promise<Record<PipelineStage, number>>;

  // Phase 3 — auditor queues + previous-day report
  escalationQueue(): Promise<EscalationQueueItem[]>;
  duplicateQueue(): Promise<DuplicatePair[]>;
  followUpQueue(stage?: "follow_up" | "post_op", page?: number, pageSize?: number): Promise<FollowUpListResult>;
  auditorReport(date?: string): Promise<AuditReport | null>;
  auditorReportDates(): Promise<string[]>;

  // Phase 3 — review actions (write; history-preserving)
  resolveDuplicate(flagId: string, decision: DuplicateDecision, notes?: string): Promise<void>;
  resolveEscalation(id: string, note?: string): Promise<void>;

  // Phase 6 — reports + settings (read)
  summaryReports(): Promise<SummaryReport[]>;
  crmSettings(): Promise<CrmSetting[]>;
  leadSourcesList(): Promise<LeadSourceInfo[]>;
}
