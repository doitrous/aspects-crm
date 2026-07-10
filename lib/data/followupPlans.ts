import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { FollowUpPlan, FollowUpPlanStep, FollowUpWorkflowType, PipelineStage } from "@/lib/types";

type Row = Record<string, unknown>;

const DB_TO_WORKFLOW: Record<string, FollowUpWorkflowType | undefined> = {
  follow_up: "follow_up",
  post_op_follow_up: "post_op",
};

const UI_WORKFLOW_TO_SETTINGS: Record<FollowUpWorkflowType, "regular" | "postop"> = {
  follow_up: "regular",
  post_op: "postop",
};

const DB_TO_UI_STAGE: Record<string, PipelineStage> = {
  new_lead: "new",
  qualified: "qualified",
  booked: "booked",
  follow_up: "follow_up",
  post_op_follow_up: "post_op",
  lost: "lost",
};

function addDelay(anchor: Date, amount: number, unit: string): Date {
  const multiplier = unit === "hours" ? 60 * 60 * 1000 : unit === "weeks" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  return new Date(anchor.getTime() + Math.max(0, amount) * multiplier);
}

function stepState(row: Row, now = Date.now()): FollowUpPlanStep["state"] {
  if (row.status === "completed" || row.completed_at) return "done";
  if (row.snoozed_at) return "snoozed";
  const dueAt = typeof row.due_at === "string" ? new Date(row.due_at).getTime() : NaN;
  if (!Number.isFinite(dueAt)) return "upcoming";
  if (dueAt < now) return "overdue";
  if (dueAt - now <= 24 * 60 * 60 * 1000) return "due";
  return "upcoming";
}

async function userNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data, error } = await supabaseAdmin()
    .from("crm_users")
    .select("id,full_name,email")
    .in("id", unique);
  if (error) throw new Error(`followUpPlan(users): ${error.message}`);
  for (const row of (data ?? []) as Row[]) {
    map.set(row.id as string, ((row.full_name as string | null) || (row.email as string | null) || "Unknown user").trim());
  }
  return map;
}

async function leadContext(leadId: string): Promise<{ uid: string; status: string; createdAt: string; updatedAt: string } | null> {
  const { data, error } = await supabaseAdmin()
    .from("leads")
    .select("id,status,created_at,updated_at")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error(`followUpPlan(lead): ${error.message}`);
  if (!data) return null;
  return {
    uid: data.id as string,
    status: data.status as string,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string,
  };
}

async function leadTagIds(leadUid: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin()
    .from("lead_tag_assignments")
    .select("tag_id")
    .eq("lead_id", leadUid);
  if (error) throw new Error(`followUpPlan(tags): ${error.message}`);
  return new Set(((data ?? []) as Row[]).map((row) => row.tag_id as string).filter(Boolean));
}

async function configuredSteps(leadUid: string, workflowType: FollowUpWorkflowType, status: string): Promise<Row[]> {
  const uiStatus = DB_TO_UI_STAGE[status];
  const query = supabaseAdmin()
    .from("crm_followup_workflow_stages")
    .select("id,workflow_type,name,stage_order,due_after_amount,due_after_unit,moderator_instruction,is_active,anchor,applicable_status,applicable_tag_id,plan_version")
    .eq("workflow_type", UI_WORKFLOW_TO_SETTINGS[workflowType])
    .eq("is_active", true)
    .order("stage_order", { ascending: true });
  const { data, error } = await query;
  if (error) throw new Error(`followUpPlan(settings): ${error.message}`);
  const tags = await leadTagIds(leadUid);
  return ((data ?? []) as Row[]).filter((row) => {
    const statusMatches = !row.applicable_status || row.applicable_status === uiStatus || row.applicable_status === status;
    const tagMatches = !row.applicable_tag_id || tags.has(row.applicable_tag_id as string);
    return statusMatches && tagMatches;
  });
}

async function ensurePlanRows(
  leadUid: string,
  workflowType: FollowUpWorkflowType,
  status: string,
  anchorIso: string,
): Promise<void> {
  const { count, error: countError } = await supabaseAdmin()
    .from("lead_follow_up_stages")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", leadUid)
    .eq("workflow_type", workflowType);
  if (countError) throw new Error(`followUpPlan(existing): ${countError.message}`);
  if ((count ?? 0) > 0) return;

  const steps = await configuredSteps(leadUid, workflowType, status);
  if (steps.length === 0) return;
  const anchor = new Date(anchorIso);
  const rows = steps.map((step, index) => ({
    lead_id: leadUid,
    workflow_type: workflowType,
    stage_number: (step.stage_order as number | null) ?? index + 1,
    due_at: addDelay(anchor, (step.due_after_amount as number | null) ?? 1, (step.due_after_unit as string | null) ?? "days").toISOString(),
    notes: null,
    status: "not_started",
    template_stage_id: step.id,
    template_version: (step.plan_version as number | null) ?? 1,
    step_name: step.name,
    anchor: step.anchor ?? "stage_entry",
  }));
  const { error } = await supabaseAdmin().from("lead_follow_up_stages").insert(rows);
  if (error) throw new Error(`followUpPlan(create): ${error.message}`);
}

export async function ensureFollowUpPlanForLead(leadId: string): Promise<void> {
  const lead = await leadContext(leadId);
  if (!lead) return;
  const workflowType = DB_TO_WORKFLOW[lead.status];
  if (!workflowType) return;
  await ensurePlanRows(lead.uid, workflowType, lead.status, lead.updatedAt ?? lead.createdAt);
}

export async function loadFollowUpPlan(leadId: string): Promise<FollowUpPlan | null> {
  const lead = await leadContext(leadId);
  if (!lead) return null;
  const workflowType = DB_TO_WORKFLOW[lead.status];
  if (!workflowType) return null;
  await ensurePlanRows(lead.uid, workflowType, lead.status, lead.updatedAt ?? lead.createdAt);

  const { data, error } = await supabaseAdmin()
    .from("lead_follow_up_stages")
    .select("id,workflow_type,stage_number,due_at,notes,status,outcome,completed_at,completed_by,assigned_to,template_stage_id,template_version,step_name,snoozed_at")
    .eq("lead_id", lead.uid)
    .eq("workflow_type", workflowType)
    .order("stage_number", { ascending: true });
  if (error) throw new Error(`followUpPlan(rows): ${error.message}`);
  const rows = (data ?? []) as Row[];
  const users = await userNames(rows.flatMap((row) => [row.completed_by as string, row.assigned_to as string]));
  return {
    workflowType,
    source: rows.some((row) => row.template_stage_id || row.step_name) ? "snapshot" : "settings",
    steps: rows.map((row) => ({
      id: row.id as string,
      templateStageId: (row.template_stage_id as string | null) ?? undefined,
      templateVersion: (row.template_version as number | null) ?? undefined,
      sequence: (row.stage_number as number | null) ?? 0,
      name: (row.step_name as string | null) || `F/U ${(row.stage_number as number | null) ?? ""}`.trim(),
      dueAt: (row.due_at as string | null) ?? undefined,
      state: stepState(row),
      notes: (row.notes as string | null) ?? undefined,
      outcome: (row.outcome as string | null) ?? undefined,
      completedAt: (row.completed_at as string | null) ?? undefined,
      completedBy: row.completed_by ? users.get(row.completed_by as string) : undefined,
      snoozedAt: (row.snoozed_at as string | null) ?? undefined,
      assignedTo: row.assigned_to ? users.get(row.assigned_to as string) : undefined,
    })),
  };
}
