import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { logActivity } from "@/lib/audit/log";
import { getSessionContext } from "@/lib/data/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  isInsideWhatsAppServiceWindow,
  listApprovedWhatsAppTemplates,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  type WhatsAppTemplateSummary,
  WhatsAppCloudApiError,
} from "@/lib/whatsapp/cloud";
import { whatsappCloudConfig } from "@/lib/whatsapp/config";
import type { Message } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 32_000;

type JsonRecord = Record<string, unknown>;
type LeadRow = {
  id: string;
  lead_id: string;
  name: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  normalized_phone: string | null;
  platform_id: string | null;
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function leadId(value: unknown): string {
  const id = stringValue(value);
  return /^L\d+$/i.test(id) ? id : "";
}

function recipientFor(lead: LeadRow): string {
  return lead.normalized_phone
    || [lead.phone_country_code, lead.phone_number].filter(Boolean).join("")
    || lead.platform_id
    || "";
}

async function latestWhatsAppIncomingAt(leadUid: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("crm_messages")
    .select("message_at")
    .eq("lead_id", leadUid)
    .eq("platform", "whatsapp")
    .eq("direction", "incoming")
    .eq("is_conversation_content", true)
    .order("message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`whatsappSend(latestIncoming): ${error.message}`);
  return (data?.message_at as string | null) ?? null;
}

async function resolveLead(humanLeadId: string): Promise<LeadRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("leads")
    .select("id,lead_id,name,phone_country_code,phone_number,normalized_phone,platform_id")
    .eq("lead_id", humanLeadId)
    .is("deleted_at", null)
    .is("merged_into_lead_id", null)
    .maybeSingle<LeadRow>();
  if (error) throw new Error(`whatsappSend(lead): ${error.message}`);
  return data ?? null;
}

function apiMessage(error: unknown): { message: string; status: number; code?: string } {
  if (error instanceof WhatsAppCloudApiError) {
    return {
      message: error.message,
      status: error.status >= 400 && error.status < 500 ? 422 : 502,
      code: error.code ? `meta_${error.code}` : "meta_error",
    };
  }
  return {
    message: error instanceof Error ? error.message : "WhatsApp could not send the message.",
    status: 500,
  };
}

async function authorizedSession() {
  const session = await getSessionContext();
  if (!session) return { response: NextResponse.json({ error: "Sign in again to send WhatsApp messages." }, { status: 401 }) } as const;
  if (session.effective.impersonating) {
    return { response: NextResponse.json({ error: "Messages cannot be sent while previewing another account." }, { status: 403 }) } as const;
  }
  if (!can(session.effective.role, "leads.edit")) {
    return { response: NextResponse.json({ error: "You are not allowed to send patient messages." }, { status: 403 }) } as const;
  }
  return { session } as const;
}

export async function GET(request: Request) {
  const auth = await authorizedSession();
  if ("response" in auth) return auth.response;
  const config = whatsappCloudConfig();
  if (!config) return NextResponse.json({ error: "WhatsApp sending is not configured." }, { status: 503 });

  const requestedLeadId = leadId(new URL(request.url).searchParams.get("leadId"));
  if (!requestedLeadId) return NextResponse.json({ error: "Lead record is invalid." }, { status: 400 });
  try {
    const lead = await resolveLead(requestedLeadId);
    if (!lead) return NextResponse.json({ error: "Lead could not be found." }, { status: 404 });
    const [lastIncomingAt, templates] = await Promise.all([
      latestWhatsAppIncomingAt(lead.id),
      listApprovedWhatsAppTemplates(config),
    ]);
    return NextResponse.json({
      canSendFreeform: isInsideWhatsAppServiceWindow(lastIncomingAt),
      lastIncomingAt,
      templates,
      templatesConfigured: Boolean(config.businessAccountId),
    });
  } catch (error) {
    const details = apiMessage(error);
    console.error("WhatsApp send options failed", error);
    return NextResponse.json({ error: details.message, code: details.code }, { status: details.status });
  }
}

export async function POST(request: Request) {
  const auth = await authorizedSession();
  if ("response" in auth) return auth.response;
  const config = whatsappCloudConfig();
  if (!config) return NextResponse.json({ error: "WhatsApp sending is not configured." }, { status: 503 });

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "The send request is too large." }, { status: 413 });
  }

  let input: JsonRecord;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "The send request is too large." }, { status: 413 });
    }
    input = record(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const humanLeadId = leadId(input.leadId);
  const mode = input.mode === "template" ? "template" : "text";
  if (!humanLeadId) return NextResponse.json({ error: "Lead record is invalid." }, { status: 400 });

  try {
    const lead = await resolveLead(humanLeadId);
    if (!lead) return NextResponse.json({ error: "Lead could not be found." }, { status: 404 });
    const recipient = recipientFor(lead);
    const lastIncomingAt = await latestWhatsAppIncomingAt(lead.id);
    if (mode === "text" && !isInsideWhatsAppServiceWindow(lastIncomingAt)) {
      return NextResponse.json({
        error: "The WhatsApp customer-service window is closed. Choose an approved template instead.",
        code: "template_required",
        lastIncomingAt,
      }, { status: 409 });
    }

    let messageText = stringValue(input.text);
    let messageType = "text";
    let templateMetadata: Record<string, unknown> | null = null;
    const requestId = crypto.randomUUID();

    await logActivity({
      actorId: auth.session.real.id,
      action: "whatsapp.message_send_requested",
      entityType: "lead",
      entityId: lead.id,
      newValues: {
        lead_id: lead.lead_id,
        mode,
        recipient_last_four: recipient.replace(/\D/g, "").slice(-4),
      },
      metadata: { request_id: requestId },
    });

    let sent;
    if (mode === "template") {
      const templateName = stringValue(input.templateName);
      const templateLanguage = stringValue(input.templateLanguage);
      if (!templateName || !templateLanguage) {
        return NextResponse.json({ error: "Choose an approved WhatsApp template." }, { status: 400 });
      }
      const templates = await listApprovedWhatsAppTemplates(config);
      const template = templates.find((candidate) => candidate.name === templateName && candidate.language === templateLanguage);
      if (!template) return NextResponse.json({ error: "That approved template is no longer available. Refresh the list and try again." }, { status: 409 });
      const headerParameters = Array.isArray(input.headerParameters) ? input.headerParameters.map(stringValue) : [];
      const bodyParameters = Array.isArray(input.bodyParameters) ? input.bodyParameters.map(stringValue) : [];
      const templateResult = await sendWhatsAppTemplate(config, {
        to: recipient,
        template: template as WhatsAppTemplateSummary,
        headerParameters,
        bodyParameters,
      });
      sent = templateResult;
      messageText = templateResult.renderedText;
      messageType = "template";
      templateMetadata = { name: template.name, language: template.language, category: template.category ?? null };
    } else {
      sent = await sendWhatsAppText(config, { to: recipient, body: messageText });
    }

    const messageAt = new Date().toISOString();
    const db = supabaseAdmin();
    const { data: messageRow, error: messageError } = await db.from("crm_messages").insert({
      lead_id: lead.id,
      source: "whatsapp_cloud_api",
      platform: "whatsapp",
      platform_message_id: sent.messageId,
      event_key: `whatsapp-outbound:${requestId}`,
      conversation_key: sent.recipientId || recipient,
      platform_user_id: sent.recipientId || recipient,
      direction: "outgoing",
      message_text: messageText,
      message_type: messageType,
      attachment_count: 0,
      is_conversation_content: true,
      message_at: messageAt,
      sent_by_type: "moderator",
      sent_by_name: auth.session.real.name,
      created_by: auth.session.real.id,
      sender_phone: recipient,
      // A successful Graph API response means Meta accepted the message. The
      // webhook receipt is the source of truth for sent/delivered/failed.
      delivery_status: null,
      record_type: "message",
      event_type: "message",
      service: "WhatsApp",
      raw_payload: sent.raw,
      message_metadata: templateMetadata ? { whatsapp: { template: templateMetadata } } : { whatsapp: { type: "text" } },
    }).select("id").single();
    if (messageError || !messageRow) {
      console.error("WhatsApp message was sent but could not be saved", { messageId: sent.messageId, error: messageError?.message });
      return NextResponse.json({
        error: "Meta accepted the message, but the CRM could not save it. Do not resend it; contact an administrator with the returned WhatsApp message ID.",
        code: "sent_but_not_recorded",
        platformMessageId: sent.messageId,
      }, { status: 502 });
    }

    const secondaryErrors: string[] = [];
    const leadUpdate = await db.from("leads").update({
      has_unread: false,
      is_reply_overdue: false,
      reply_overdue_at: null,
      last_outgoing_at: messageAt,
      last_contact_at: messageAt,
    }).eq("id", lead.id).is("deleted_at", null);
    if (leadUpdate.error) secondaryErrors.push(`lead: ${leadUpdate.error.message}`);

    const timeline = await db.from("lead_timeline_events").insert({
      lead_id: lead.id,
      event_type: "message_out",
      title: "WhatsApp message accepted by Meta",
      body: messageText,
      actor_user_id: auth.session.real.id,
      metadata: { platform_message_id: sent.messageId, source: "whatsapp_cloud_api", mode },
    });
    if (timeline.error) secondaryErrors.push(`timeline: ${timeline.error.message}`);

    try {
      await logActivity({
        actorId: auth.session.real.id,
        action: "whatsapp.message_accepted",
        entityType: "message",
        entityId: messageRow.id as string,
        newValues: { lead_id: lead.lead_id, platform_message_id: sent.messageId, mode },
        metadata: { request_id: requestId, lead_id: lead.id },
      });
    } catch (auditError) {
      secondaryErrors.push(`audit: ${auditError instanceof Error ? auditError.message : "unknown error"}`);
    }
    if (secondaryErrors.length) console.error("WhatsApp message accepted with CRM follow-up errors", secondaryErrors);

    const message: Message = {
      id: messageRow.id as string,
      leadId: lead.lead_id,
      channel: "whatsapp",
      direction: "outgoing",
      body: messageText,
      createdAt: messageAt,
      authorName: auth.session.real.name,
      platformMessageId: sent.messageId,
      messageType,
    };
    return NextResponse.json({ ok: true, message, warning: secondaryErrors.length ? "Meta accepted the message, but some CRM activity fields could not be updated." : undefined });
  } catch (error) {
    const details = apiMessage(error);
    console.error("WhatsApp send failed", error);
    return NextResponse.json({ error: details.message, code: details.code }, { status: details.status });
  }
}
