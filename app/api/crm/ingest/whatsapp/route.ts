import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { whatsappIngestSecret } from "@/lib/whatsapp/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Media = {
  type?: string;
  rawType?: string;
  url?: string;
  title?: string;
  name?: string;
  stickerId?: string;
};

type DeliveryStatus = "sent" | "delivered" | "seen";

type Payload = {
  messageId?: string;
  conversationId?: string;
  whatsappUserId?: string;
  phone?: string;
  phoneCountryCode?: string;
  patientName?: string;
  direction?: "incoming" | "outgoing";
  text?: string;
  timestamp?: string;
  deliveryStatusAt?: string;
  media?: Media[];
  messageType?: string;
  deliveryStatus?: DeliveryStatus | null;
  senderName?: string;
  statusOnly?: boolean;
  rawPayload?: unknown;
  messageMetadata?: Record<string, unknown>;
};

function bearer(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.headers.get("x-crm-ingest-key") ?? req.headers.get("x-api-key");
}

function normalizePhone(value?: string | null): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits || null;
}

function records(body: unknown): Payload[] {
  if (Array.isArray(body)) return body as Payload[];
  if (body && typeof body === "object" && Array.isArray((body as { records?: unknown }).records)) {
    return (body as { records: Payload[] }).records;
  }
  return body ? [body as Payload] : [];
}

function isoOrNow(value?: string | null): string {
  return value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

async function updateExistingMessage(
  db: ReturnType<typeof supabaseAdmin>,
  messageId: string,
  input: Payload,
  at: string,
): Promise<{ statusUpdated: boolean; metadataUpdated: boolean }> {
  let metadataUpdated = false;
  if (input.messageMetadata && Object.keys(input.messageMetadata).length) {
    const { error } = await db
      .from("crm_messages")
      .update({ message_metadata: input.messageMetadata })
      .eq("id", messageId);
    if (error) throw new Error(`whatsappMessage(metadata): ${error.message}`);
    metadataUpdated = true;
  }

  if (!input.deliveryStatus) return { statusUpdated: false, metadataUpdated };

  const patch: Record<string, string> =
    input.deliveryStatus === "seen"
      ? { delivery_status: "seen", seen_at: at }
      : input.deliveryStatus === "delivered"
        ? { delivery_status: "delivered", delivered_at: at }
        : { delivery_status: "sent" };

  let query = db
    .from("crm_messages")
    .update(patch)
    .eq("id", messageId)
    .eq("direction", "outgoing");

  if (input.deliveryStatus === "seen") {
    query = query.neq("delivery_status", "seen");
  } else if (input.deliveryStatus === "delivered") {
    query = query.neq("delivery_status", "seen").neq("delivery_status", "delivered");
  } else {
    query = query.is("delivery_status", null);
  }

  const { data, error } = await query.select("id");
  if (error) throw new Error(`whatsappMessage(status): ${error.message}`);
  return { statusUpdated: Boolean(data?.length), metadataUpdated };
}

async function leadFor(input: Payload): Promise<{ id: string; lead_id: string }> {
  const db = supabaseAdmin();
  const phone = normalizePhone(input.phone ?? input.whatsappUserId ?? input.conversationId);
  const platformId = input.whatsappUserId || input.phone || input.conversationId || phone;
  let query = db.from("leads").select("id,lead_id");
  if (phone) query = query.or(`normalized_phone.eq.${phone},platform_id.eq.${platformId},normalized_platform_id.eq.${phone}`);
  else query = query.eq("platform_id", platformId);
  const { data: existing, error: findError } = await query.limit(1).maybeSingle();
  if (findError) throw new Error(`whatsappLead(find): ${findError.message}`);
  if (existing) return existing as { id: string; lead_id: string };

  const { data: generatedLeadId, error: idError } = await db.rpc("crm_generate_lead_id");
  if (idError) throw new Error(`whatsappLead(id): ${idError.message}`);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("leads")
    .insert({
      lead_id: String(generatedLeadId),
      name: input.patientName?.trim() || input.senderName?.trim() || input.phone || "WhatsApp lead",
      phone_country_code: input.phoneCountryCode || null,
      phone_number: input.phone || null,
      normalized_phone: phone,
      platform: "whatsapp",
      platform_id: platformId,
      normalized_platform_id: phone ?? platformId,
      status: "new_lead",
      has_unread: input.direction !== "outgoing",
      first_contact_at: now,
      last_contact_at: now,
      last_incoming_at: input.direction === "outgoing" ? null : now,
      last_outgoing_at: input.direction === "outgoing" ? now : null,
      escalation_status: "none",
    })
    .select("id,lead_id")
    .single();
  if (error) throw new Error(`whatsappLead(create): ${error.message}`);
  return data as { id: string; lead_id: string };
}

async function ingestOne(input: Payload) {
  if (!input.messageId) throw new Error("messageId is required.");
  const direction = input.direction === "outgoing" ? "outgoing" : "incoming";
  const db = supabaseAdmin();
  const messageAt = isoOrNow(input.timestamp);
  const statusAt = isoOrNow(input.deliveryStatusAt ?? input.timestamp);

  const { data: existing, error: existingError } = await db
    .from("crm_messages")
    .select("id")
    .eq("platform", "whatsapp")
    .eq("platform_message_id", input.messageId)
    .maybeSingle();
  if (existingError) throw new Error(`whatsappMessage(find): ${existingError.message}`);
  if (existing?.id) {
    const updates = await updateExistingMessage(db, existing.id as string, input, statusAt);
    return { messageId: existing.id as string, inserted: false, ...updates };
  }

  if (input.statusOnly) {
    return { messageId: input.messageId, inserted: false, skipped: true, reason: "status_without_message" };
  }

  const lead = await leadFor(input);

  const media = Array.isArray(input.media) ? input.media : [];
  const deliveryStatus = direction === "outgoing" ? input.deliveryStatus ?? "sent" : input.deliveryStatus ?? null;
  const { data: message, error } = await db
    .from("crm_messages")
    .insert({
      lead_id: lead.id,
      platform: "whatsapp",
      platform_message_id: input.messageId,
      conversation_key: input.conversationId || input.whatsappUserId || input.phone || null,
      platform_user_id: input.whatsappUserId || input.phone || input.conversationId || null,
      direction,
      message_text: input.text ?? "",
      message_type: input.messageType || media[0]?.type || "text",
      attachment_count: media.length,
      is_conversation_content: true,
      message_at: messageAt,
      sent_by_name: input.senderName || (direction === "outgoing" ? "Aspects Clinica" : input.patientName) || null,
      sender_phone: input.phone || null,
      delivery_status: deliveryStatus,
      delivered_at: deliveryStatus === "delivered" ? statusAt : null,
      seen_at: deliveryStatus === "seen" ? statusAt : null,
      record_type: "message",
      event_type: "message",
      service: "WhatsApp",
      raw_payload: input.rawPayload ?? {},
      message_metadata: input.messageMetadata ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`whatsappMessage(insert): ${error.message}`);

  if (media.length) {
    const { error: attachmentError } = await db.from("crm_message_attachments").insert(
      media.map((item, index) => ({
        message_id: message.id,
        attachment_index: index,
        type: item.type || "file",
        raw_type: item.rawType || item.type || null,
        url: item.url || null,
        title: item.title || null,
        name: item.name || null,
        sticker_id: item.stickerId || null,
      })),
    );
    if (attachmentError) throw new Error(`whatsappAttachment(insert): ${attachmentError.message}`);
  }

  const patch = direction === "outgoing"
    ? { has_unread: false, last_outgoing_at: messageAt, last_contact_at: messageAt }
    : { has_unread: true, last_incoming_at: messageAt, last_contact_at: messageAt };
  const { error: leadError } = await db.from("leads").update(patch).eq("id", lead.id);
  if (leadError) throw new Error(`whatsappLead(update): ${leadError.message}`);

  await db.from("lead_timeline_events").insert({
    lead_id: lead.id,
    event_type: direction === "outgoing" ? "message_out" : "message_in",
    title: direction === "outgoing" ? "WhatsApp message sent" : "WhatsApp message received",
    body: input.text ?? null,
    metadata: { platform_message_id: input.messageId, source: "whatsapp" },
  });

  return { leadId: lead.lead_id, messageId: message.id as string, inserted: true };
}

export async function POST(req: Request) {
  const secret = whatsappIngestSecret();
  if (!secret) return NextResponse.json({ error: "WhatsApp ingest is not configured." }, { status: 503 });
  if (bearer(req) !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  try {
    const body = await req.json();
    const result = await Promise.all(records(body).map(ingestOne));
    return NextResponse.json({ ok: true, records: result });
  } catch (error) {
    console.error("WhatsApp ingest failed", error);
    return NextResponse.json(
      { ok: false, error: "WhatsApp ingest failed." },
      { status: 400 },
    );
  }
}
