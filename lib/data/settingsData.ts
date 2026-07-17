import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Read side for the Settings backbone (§C). Every editor consumes live data
 * from the same table its feature already reads — no parallel config store:
 *   tags            → lead_tags
 *   lost reasons    → lost_reasons
 *   SLA rules       → crm_stage_reply_rules
 *   follow-up rules → crm_followup_workflow_stages
 *   target CPL      → auditor_settings
 *   AI prompt       → ai_prompt_templates
 *   email rules     → crm_email_rules
 */

export interface TagSetting {
  id: string;
  name: string;
  color: string | null;
  isActive: boolean;
  displayOrder: number;
}

export interface LostReasonSetting {
  id: string;
  label: string;
  isActive: boolean;
  displayOrder: number;
}

export interface EscalationReasonSetting {
  id: string;
  label: string;
  severity: "low" | "medium" | "high" | "critical";
  isActive: boolean;
  displayOrder: number;
}

export interface SlaRuleSetting {
  id: string;
  stageKey: string;
  stageLabel: string;
  replyDeadlineMinutes: number;
  warningThresholdMinutes: number;
  isActive: boolean;
}

export interface FollowUpStageSetting {
  id: string;
  workflowType: "regular" | "postop";
  name: string;
  stageOrder: number;
  dueAfterAmount: number;
  dueAfterUnit: "hours" | "days" | "weeks";
  anchor: string;
  applicableStatus: string | null;
  applicableTagId: string | null;
  planVersion: number;
  moderatorInstruction: string | null;
  isActive: boolean;
}

export interface AuditorSettingsRow {
  id: string | null;
  targetCplEgp: number;
  aiSamplingPercent: number;
  responseTimeThresholdMinutes: number;
  followupCompletionTarget: number;
}

export interface AiPromptSetting {
  id: string | null;
  promptKey: string;
  title: string;
  systemPrompt: string;
  replyRules: string | null;
  tone: string | null;
  isActive: boolean;
}

export interface EmailRuleSetting {
  id: string;
  ruleKey: string | null;
  name: string;
  description: string | null;
  trigger: string;
  isActive: boolean;
  conditions: Record<string, unknown>;
  recipients: Array<Record<string, unknown>>;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  schedule: Record<string, unknown>;
  dedupeWindowHours: number | null;
}

export interface IngestLogSetting {
  id: string;
  createdAt: string;
  source: string | null;
  platform: string | null;
  eventType: string | null;
  eventAction: string | null;
  eventKey: string | null;
  direction: string | null;
  platformUserId: string | null;
  conversationKey: string | null;
  messageText: string | null;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  skipReason: string | null;
  errors: string[];
}

export interface IngestionFailureSetting extends IngestLogSetting {
  recovered: boolean;
}

function ingestErrorMessages(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(ingestErrorMessages);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return [message.trim()];
    return [JSON.stringify(value)];
  }
  return [];
}

export async function listTags(): Promise<TagSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("lead_tags")
    .select("id,name,color,is_active,display_order")
    .order("display_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listTags: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    color: (r.color as string) ?? null,
    isActive: Boolean(r.is_active),
    displayOrder: (r.display_order as number) ?? 0,
  }));
}

export async function listLostReasons(): Promise<LostReasonSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("lost_reasons")
    .select("id,label,is_active,display_order")
    .order("display_order", { ascending: true });
  if (error) throw new Error(`listLostReasons: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    isActive: Boolean(r.is_active),
    displayOrder: (r.display_order as number) ?? 0,
  }));
}

export async function listEscalationReasons(): Promise<EscalationReasonSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_escalation_reasons")
    .select("id,label,severity,is_active,display_order")
    .order("display_order", { ascending: true })
    .order("label", { ascending: true });
  if (error) {
    if (error.message.includes("crm_escalation_reasons")) return [];
    throw new Error(`listEscalationReasons: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: r.label as string,
    severity: (r.severity as "low" | "medium" | "high" | "critical") ?? "medium",
    isActive: Boolean(r.is_active),
    displayOrder: (r.display_order as number) ?? 0,
  }));
}

export async function listSlaRules(): Promise<SlaRuleSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_stage_reply_rules")
    .select("id,stage_key,stage_label,reply_deadline_minutes,warning_threshold_minutes,is_active")
    .order("stage_label", { ascending: true });
  if (error) throw new Error(`listSlaRules: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    stageKey: r.stage_key as string,
    stageLabel: r.stage_label as string,
    replyDeadlineMinutes: (r.reply_deadline_minutes as number) ?? 30,
    warningThresholdMinutes: (r.warning_threshold_minutes as number) ?? 20,
    isActive: Boolean(r.is_active),
  }));
}

export async function listFollowUpStages(): Promise<FollowUpStageSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_followup_workflow_stages")
    .select("id,workflow_type,name,stage_order,due_after_amount,due_after_unit,anchor,applicable_status,applicable_tag_id,plan_version,moderator_instruction,is_active")
    .order("workflow_type", { ascending: true })
    .order("stage_order", { ascending: true });
  if (error) throw new Error(`listFollowUpStages: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    workflowType: (r.workflow_type as "regular" | "postop") ?? "regular",
    name: r.name as string,
    stageOrder: (r.stage_order as number) ?? 0,
    dueAfterAmount: (r.due_after_amount as number) ?? 0,
    dueAfterUnit: (r.due_after_unit as "hours" | "days" | "weeks") ?? "days",
    anchor: (r.anchor as string) ?? "stage_entry",
    applicableStatus: (r.applicable_status as string) ?? null,
    applicableTagId: (r.applicable_tag_id as string) ?? null,
    planVersion: (r.plan_version as number) ?? 1,
    moderatorInstruction: (r.moderator_instruction as string) ?? null,
    isActive: Boolean(r.is_active),
  }));
}

export async function getAuditorSettings(): Promise<AuditorSettingsRow> {
  const { data, error } = await supabaseAdmin()
    .from("auditor_settings")
    .select("id,target_cpl_egp,ai_sampling_percent,response_time_threshold_minutes,followup_completion_target")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getAuditorSettings: ${error.message}`);
  return {
    id: (data?.id as string) ?? null,
    targetCplEgp: (data?.target_cpl_egp as number) ?? 0,
    aiSamplingPercent: (data?.ai_sampling_percent as number) ?? 50,
    responseTimeThresholdMinutes: (data?.response_time_threshold_minutes as number) ?? 30,
    followupCompletionTarget: (data?.followup_completion_target as number) ?? 85,
  };
}

export async function getAiPrompt(): Promise<AiPromptSetting> {
  const { data, error } = await supabaseAdmin()
    .from("ai_prompt_templates")
    .select("id,prompt_key,title,system_prompt,reply_rules,tone,is_active")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`getAiPrompt: ${error.message}`);
  return {
    id: (data?.id as string) ?? null,
    promptKey: (data?.prompt_key as string) ?? "crm_reply_assistant",
    title: (data?.title as string) ?? "CRM reply assistant",
    systemPrompt: (data?.system_prompt as string) ?? "",
    replyRules: (data?.reply_rules as string) ?? null,
    tone: (data?.tone as string) ?? null,
    isActive: data ? Boolean(data.is_active) : false,
  };
}

export async function listEmailRules(): Promise<EmailRuleSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_email_rules")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listEmailRules: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    ruleKey: (r.rule_key as string) ?? null,
    name: r.name as string,
    description: (r.description as string) ?? null,
    trigger: r.trigger as string,
    isActive: Boolean(r.is_active),
    conditions: (r.conditions ?? {}) as Record<string, unknown>,
    recipients: (r.recipients ?? []) as Array<Record<string, unknown>>,
    subjectTemplate: (r.subject_template as string) ?? null,
    bodyTemplate: (r.body_template as string) ?? null,
    schedule: (r.schedule ?? {}) as Record<string, unknown>,
    dedupeWindowHours: (r.dedupe_window_hours as number) ?? null,
  }));
}

export async function listIngestLogs(): Promise<IngestLogSetting[]> {
  const { data, error } = await supabaseAdmin()
    .from("crm_ingest_logs")
    .select("id,created_at,source,platform,event_type,event_action,event_key,direction,platform_user_id,conversation_key,message_text,created,updated,skipped,skip_reason,errors")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`listIngestLogs: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string, createdAt: r.created_at as string,
    source: (r.source as string | null) ?? null, platform: (r.platform as string | null) ?? null,
    eventType: (r.event_type as string | null) ?? null, eventAction: (r.event_action as string | null) ?? null,
    eventKey: (r.event_key as string | null) ?? null,
    direction: (r.direction as string | null) ?? null, platformUserId: (r.platform_user_id as string | null) ?? null,
    conversationKey: (r.conversation_key as string | null) ?? null, messageText: (r.message_text as string | null) ?? null,
    created: Boolean(r.created), updated: Boolean(r.updated), skipped: Boolean(r.skipped),
    skipReason: (r.skip_reason as string | null) ?? null, errors: ingestErrorMessages(r.errors),
  }));
}

/** Recent failed webhook events plus whether a later idempotent retry recovered them. */
export async function listIngestionFailures(limit = 25): Promise<IngestionFailureSetting[]> {
  const db = supabaseAdmin();
  const { data, error } = await db.from("crm_ingest_logs")
    .select("id,created_at,source,platform,event_type,event_action,event_key,direction,platform_user_id,conversation_key,message_text,created,updated,skipped,skip_reason,errors")
    .eq("skip_reason", "error")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(`listIngestionFailures: ${error.message}`);
  const failed = data ?? [];
  const keys = [...new Set(failed.map((row) => row.event_key as string | null).filter((key): key is string => Boolean(key)))];
  const attempts = keys.length
    ? await db.from("crm_ingest_logs").select("created_at,event_key,created,updated,skipped,skip_reason").in("event_key", keys)
    : { data: [], error: null };
  if (attempts.error) throw new Error(`listIngestionFailures(attempts): ${attempts.error.message}`);
  return failed.map((r) => {
    const recovered = (attempts.data ?? []).some((attempt) => (
      attempt.event_key === r.event_key && attempt.created_at > r.created_at &&
      (attempt.created || attempt.updated || attempt.skip_reason === "duplicate")
    ));
    return {
      id: r.id as string, createdAt: r.created_at as string,
      source: (r.source as string | null) ?? null, platform: (r.platform as string | null) ?? null,
      eventType: (r.event_type as string | null) ?? null, eventAction: (r.event_action as string | null) ?? null,
      eventKey: (r.event_key as string | null) ?? null, direction: (r.direction as string | null) ?? null,
      platformUserId: (r.platform_user_id as string | null) ?? null,
      conversationKey: (r.conversation_key as string | null) ?? null, messageText: (r.message_text as string | null) ?? null,
      created: Boolean(r.created), updated: Boolean(r.updated), skipped: Boolean(r.skipped),
      skipReason: (r.skip_reason as string | null) ?? null, errors: ingestErrorMessages(r.errors), recovered,
    };
  });
}
