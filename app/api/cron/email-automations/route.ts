import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchRule } from "@/lib/email/send";
import { secretsEqual } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ") && secretsEqual(header.slice(7), secret)) return true;
  return secretsEqual(new URL(req.url).searchParams.get("token"), secret);
}

/**
 * Runs time-based email automations. Call this endpoint at least hourly; each
 * rule's dedupe window prevents repeat sends for the same follow-up stage.
 */
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  const { data: rules, error: ruleError } = await db
    .from("crm_email_rules")
    .select("rule_key,conditions")
    .eq("trigger", "followup_reminder")
    .eq("is_active", true);
  if (ruleError) return NextResponse.json({ error: ruleError.message }, { status: 500 });

  const now = new Date();
  const outcomes: Array<{ ruleKey: string; followUpId: string; status: string }> = [];
  for (const rule of rules ?? []) {
    const conditions = (rule.conditions ?? {}) as Record<string, unknown>;
    const hoursBefore = Math.max(1, Number(conditions.hours_before) || 24);
    const cutoff = new Date(now.getTime() + hoursBefore * 3_600_000).toISOString();
    let query = db
      .from("lead_follow_up_stages")
      .select("id,lead_id,workflow_type,stage_number,due_at,notes")
      .in("status", ["not_started", "pending", "overdue"])
      .gt("due_at", now.toISOString())
      .lte("due_at", cutoff);
    if (conditions.workflow_type) query = query.eq("workflow_type", String(conditions.workflow_type));
    const { data: stages } = await query;
    const leadUids = [...new Set((stages ?? []).map((stage) => stage.lead_id as string))];
    const { data: leads } = leadUids.length
      ? await db.from("leads").select("id,lead_id,name").in("id", leadUids).is("deleted_at", null)
      : { data: [] as Array<{ id: string; lead_id: string; name: string }> };
    const leadById = new Map((leads ?? []).map((lead) => [lead.id as string, lead]));

    for (const stage of stages ?? []) {
      const lead = leadById.get(stage.lead_id as string);
      const result = await dispatchRule(rule.rule_key as string, {
        discriminator: stage.id as string,
        leadUid: stage.lead_id as string,
        ctx: {
          lead_id: (lead?.lead_id as string) ?? "",
          patient_name: (lead?.name as string) ?? "Lead",
          followup_number: Number(stage.stage_number) || 1,
          followup_due_at: (stage.due_at as string) ?? "",
          workflow_type: (stage.workflow_type as string) ?? "follow_up",
          notes: (stage.notes as string) ?? "",
        },
      });
      outcomes.push({ ruleKey: rule.rule_key as string, followUpId: stage.id as string, status: result.status });
    }
  }
  return NextResponse.json({ ok: true, processed: outcomes.length, outcomes });
}

export const GET = POST;
