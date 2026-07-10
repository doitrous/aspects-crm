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
import type {
  DashboardMetrics,
  DataProvider,
  LeadFilters,
} from "@/lib/data/contracts";
import { mockProvider } from "@/lib/data/mock";
import { supabaseProvider } from "@/lib/data/supabase";

export type { LeadFilters, DashboardMetrics } from "@/lib/data/contracts";

/**
 * Data-source router. `CRM_DATA_SOURCE=supabase` wires the app to the live
 * Postgres schema; anything else keeps the in-memory seed layer. This module is
 * only ever imported by server code (pages/layout), so pulling in the
 * server-only Supabase provider here is safe.
 */
const provider: DataProvider =
  process.env.CRM_DATA_SOURCE === "supabase" ? supabaseProvider : mockProvider;

/** Current reference time (fixed seed date in mock mode, wall clock live). */
export const NOW: Date = provider.now();

export function getLeads(filters?: LeadFilters): Promise<Lead[]> {
  return provider.getLeads(filters);
}
export function getLead(id: string): Promise<Lead | undefined> {
  return provider.getLead(id);
}
export function messagesFor(leadId: string, channels?: Message["channel"][]): Promise<Message[]> {
  return provider.messagesFor(leadId, channels);
}
export function commentsFor(leadId: string): Promise<Comment[]> {
  return provider.commentsFor(leadId);
}
export function attributionFor(leadId: string): Promise<LeadAttribution | null> {
  return provider.attributionFor(leadId);
}
export function bookingsFor(leadId: string): Promise<Booking[]> {
  return provider.bookingsFor(leadId);
}
export function escalationsFor(leadId: string): Promise<Escalation[]> {
  return provider.escalationsFor(leadId);
}
export function duplicatesFor(leadId: string): Promise<DuplicateGroup[]> {
  return provider.duplicatesFor(leadId);
}
export function leadTimeline(leadId: string): Promise<TimelineEvent[]> {
  return provider.leadTimeline(leadId);
}
export function dashboardMetrics(): Promise<DashboardMetrics> {
  return provider.dashboardMetrics();
}
export function pipelineCounts(): Promise<Record<PipelineStage, number>> {
  return provider.pipelineCounts();
}
export function escalationQueue(): Promise<EscalationQueueItem[]> {
  return provider.escalationQueue();
}
export function duplicateQueue(): Promise<DuplicatePair[]> {
  return provider.duplicateQueue();
}
export function followUpQueue(): Promise<FollowUpItem[]> {
  return provider.followUpQueue();
}
export function auditorReport(date?: string): Promise<AuditReport | null> {
  return provider.auditorReport(date);
}
export function auditorReportDates(): Promise<string[]> {
  return provider.auditorReportDates();
}
export function resolveDuplicate(
  flagId: string,
  decision: DuplicateDecision,
  notes?: string,
): Promise<void> {
  return provider.resolveDuplicate(flagId, decision, notes);
}
export function resolveEscalation(id: string, note?: string): Promise<void> {
  return provider.resolveEscalation(id, note);
}
export function summaryReports(): Promise<SummaryReport[]> {
  return provider.summaryReports();
}
export function crmSettings(): Promise<CrmSetting[]> {
  return provider.crmSettings();
}
export function leadSourcesList(): Promise<LeadSourceInfo[]> {
  return provider.leadSourcesList();
}
