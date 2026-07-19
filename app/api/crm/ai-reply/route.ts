import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getSessionContext } from "@/lib/data/session";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_INSTRUCTION = 1_500;
const MAX_REPLY = 8_000;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  if (Array.isArray(value)) return asRecord(value[0]);
  return value && typeof value === "object" ? value as JsonRecord : {};
}

function firstText(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const nested = firstText(value as JsonRecord, keys);
      if (nested) return nested;
    }
  }
  return "";
}

async function logSuggestion(values: JsonRecord) {
  try {
    const { error } = await supabaseAdmin().from("ai_reply_suggestions").insert(values);
    if (error) console.error("AI reply suggestion audit log failed", error.message);
  } catch (error) {
    console.error("AI reply suggestion audit log failed", error);
  }
}

export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) return NextResponse.json({ error: "Sign in again to use the AI reply assistant." }, { status: 401 });
  if (!can(session.effective.role, "leads.edit")) {
    return NextResponse.json({ error: "You are not allowed to request patient reply suggestions." }, { status: 403 });
  }

  let input: JsonRecord;
  try {
    input = asRecord(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const humanLeadId = typeof input.leadId === "string" ? input.leadId.trim() : "";
  const instruction = typeof input.instruction === "string" ? input.instruction.trim() : "";
  const channel = typeof input.channel === "string" ? input.channel.trim() : "";
  if (!/^L\d+$/i.test(humanLeadId)) return NextResponse.json({ error: "Lead record is invalid." }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: "Tell the assistant what kind of reply you need." }, { status: 400 });
  if (instruction.length > MAX_INSTRUCTION) return NextResponse.json({ error: "Your instruction is too long." }, { status: 400 });

  const db = supabaseAdmin();
  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id,lead_id,name,phone_country_code,phone_number,status,platform,service_name")
    .eq("lead_id", humanLeadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (leadError || !lead) return NextResponse.json({ error: "Lead could not be found." }, { status: 404 });

  let messageQuery = db
    .from("crm_messages")
    .select("id,conversation_id,platform,direction,message_text,message_at,sent_by_name")
    .eq("lead_id", lead.id)
    .eq("is_conversation_content", true)
    .order("message_at", { ascending: false })
    .limit(16);
  if (["facebook", "instagram", "whatsapp"].includes(channel)) messageQuery = messageQuery.eq("platform", channel);
  const { data: reverseMessages, error: messageError } = await messageQuery;
  if (messageError) return NextResponse.json({ error: "Conversation history could not be loaded." }, { status: 500 });
  const messages = [...(reverseMessages ?? [])].reverse();
  const lastIncoming = [...messages].reverse().find((message) => message.direction === "incoming" && String(message.message_text ?? "").trim());
  if (!lastIncoming) return NextResponse.json({ error: "There is no customer message to base a recommendation on." }, { status: 400 });

  const { data: promptTemplate } = await db
    .from("ai_prompt_templates")
    .select("id,prompt_key,system_prompt,reply_rules,tone,language,required_fields,escalation_rules,version")
    .eq("is_active", true)
    .in("prompt_key", ["reply_assistant", "crm_reply_assistant"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const webhookUrl = process.env.N8N_AI_REPLY_WEBHOOK_URL?.trim();
  const requestId = crypto.randomUUID();
  const auditBase = {
    lead_id: lead.id,
    conversation_id: lastIncoming.conversation_id ?? null,
    requested_by: session.real.id,
    prompt_template_id: promptTemplate?.id ?? null,
    moderator_instruction: instruction,
    last_customer_message: String(lastIncoming.message_text),
    provider: "n8n",
  };
  if (!webhookUrl) {
    await logSuggestion({ ...auditBase, status: "error", error_message: "N8N_AI_REPLY_WEBHOOK_URL is not configured" });
    return NextResponse.json({ error: "The AI workflow is not connected yet. Add N8N_AI_REPLY_WEBHOOK_URL in Coolify, then redeploy the CRM." }, { status: 503 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const secret = process.env.N8N_AI_REPLY_WEBHOOK_SECRET?.trim();
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}`, "x-ai-webhook-secret": secret } : {}),
      },
      body: JSON.stringify({
        request_id: requestId,
        requested_at: new Date().toISOString(),
        moderator: { id: session.real.id, name: session.real.name, role: session.real.role },
        lead: {
          id: lead.id,
          lead_id: lead.lead_id,
          patient_name: lead.name,
          phone: [lead.phone_country_code, lead.phone_number].filter(Boolean).join(" "),
          stage: lead.status,
          platform: lead.platform,
          service: lead.service_name,
        },
        channel: lastIncoming.platform,
        last_customer_message: lastIncoming.message_text,
        moderator_instruction: instruction,
        conversation: messages.map((message) => ({
          direction: message.direction,
          channel: message.platform,
          text: message.message_text,
          sent_at: message.message_at,
          author: message.sent_by_name,
        })),
        prompt: promptTemplate ? {
          key: promptTemplate.prompt_key,
          version: promptTemplate.version,
          system_prompt: promptTemplate.system_prompt,
          reply_rules: promptTemplate.reply_rules,
          tone: promptTemplate.tone,
          language: promptTemplate.language,
          required_fields: promptTemplate.required_fields,
          escalation_rules: promptTemplate.escalation_rules,
        } : null,
        contract: {
          response: { suggested_reply: "string", suggested_next_action: "string (optional)", should_escalate: "boolean (optional)", missing_fields: "string[] (optional)" },
          sends_message: false,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({}));
    const result = asRecord(raw);
    if (!response.ok) throw new Error(firstText(result, ["error", "message"]) || `n8n returned ${response.status}`);
    const suggestedReply = firstText(result, ["suggested_reply", "suggestedReply", "reply", "output", "text", "message"]).slice(0, MAX_REPLY);
    if (!suggestedReply) throw new Error("n8n did not return suggested_reply");
    const nextAction = firstText(result, ["suggested_next_action", "suggestedNextAction", "next_action"]);
    const missingFields = Array.isArray(result.missing_fields) ? result.missing_fields.filter((value): value is string => typeof value === "string") : [];
    const shouldEscalate = result.should_escalate === true || result.shouldEscalate === true;
    await logSuggestion({
      ...auditBase,
      suggested_reply: suggestedReply,
      suggested_next_action: nextAction || null,
      missing_fields: missingFields,
      should_escalate: shouldEscalate,
      raw_ai_metadata: { request_id: requestId },
      status: "success",
    });
    return NextResponse.json({ suggestedReply, nextAction, missingFields, shouldEscalate });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "The AI workflow timed out." : error instanceof Error ? error.message : "The AI workflow failed.";
    await logSuggestion({ ...auditBase, status: "error", error_message: message, raw_ai_metadata: { request_id: requestId } });
    return NextResponse.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
