import type {
  AuditReport,
  Booking,
  Comment,
  CrmSetting,
  DuplicateDecision,
  DuplicateGroup,
  DuplicatePair,
  DuplicateQueueResult,
  DuplicateQueueView,
  Escalation,
  EscalationQueueItem,
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
  FollowUpListResult,
  LeadListResult,
  LeadFilters,
} from "@/lib/data/contracts";
import { mockProvider } from "@/lib/data/mock";
import { resolveCrmDataSource } from "@/lib/data/source";
import { supabaseProvider } from "@/lib/data/supabase";

export type { LeadFilters, DashboardMetrics, LeadListResult } from "@/lib/data/contracts";

export { resolveCrmDataSource } from "@/lib/data/source";

/**
 * Data-source router. Production and unset environments use live Supabase.
 * Mock data is now an explicit development/test choice only, so a missing
 * Coolify variable cannot silently ship the CRM as a demo.
 */
const provider: DataProvider =
  resolveCrmDataSource() === "mock" ? mockProvider : supabaseProvider;

/** Current reference time (fixed seed date in mock mode, wall clock live). */
export const NOW: Date = provider.now();

export function getLeads(filters?: LeadFilters): Promise<Lead[]> {
  return provider.getLeads(filters);
}
export async function getLeadsPage(filters?: LeadFilters): Promise<LeadListResult> {
  if (provider.getLeadsPage) return provider.getLeadsPage(filters);
  const pageSize = Math.min(100, Math.max(1, Math.floor(filters?.pageSize ?? 30)));
  const page = Math.max(1, Math.floor(filters?.page ?? 1));
  const all = await provider.getLeads(filters);
  const from = (page - 1) * pageSize;
  return { leads: all.slice(from, from + pageSize), total: all.length, page, pageSize };
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
export function duplicateQueuePage(view?: DuplicateQueueView, page?: number, pageSize?: number): Promise<DuplicateQueueResult> {
  return provider.duplicateQueuePage(view, page, pageSize);
}
export function followUpQueue(stage?: "follow_up" | "post_op", page?: number, pageSize?: number): Promise<FollowUpListResult> {
  return provider.followUpQueue(stage, page, pageSize);
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
