// n8n Code node: "Normalize WhatsApp Message"
// Mode: Run Once for All Items
//
// Send the output to:
//   POST https://<crm-domain>/api/crm/ingest/whatsapp
//   Authorization: Bearer <WHATSAPP_INGEST_API_KEY>

const inputItems = $input.all();

function asArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function clean(value) {
  return value === undefined || value === "" ? null : value;
}

function isoFromTimestamp(value) {
  if (!value) return new Date().toISOString();

  const raw = String(value);
  const numeric = Number(raw);

  if (!Number.isNaN(numeric)) {
    const ms = raw.length <= 10 ? numeric * 1000 : numeric;
    return new Date(ms).toISOString();
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function deliveryStatus(value) {
  const status = String(value ?? "").toLowerCase();
  if (status === "read" || status === "seen") return "seen";
  if (status === "delivered") return "delivered";
  if (status === "sent") return "sent";
  if (status === "failed") return "failed";
  return null;
}

function contactName(contacts, phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  const contact = contacts.find((c) => c.wa_id === phone || c.wa_id === digits);
  return clean(contact?.profile?.name);
}

function textFromMessage(message) {
  return clean(
    message.text?.body ??
      message.text?.text ??
      message.button?.text ??
      message.interactive?.button_reply?.title ??
      message.interactive?.list_reply?.title ??
      message.interactive?.body?.text ??
      message.interactive?.footer?.text ??
      message.image?.caption ??
      message.video?.caption ??
      message.document?.caption ??
      message.body?.text ??
      message.body ??
      message.message,
  ) ?? "";
}

function mediaFromMessage(message) {
  const mediaTypes = ["image", "video", "audio", "voice", "document", "sticker"];
  const media = [];

  for (const type of mediaTypes) {
    const value = message[type];
    if (!value) continue;

    media.push({
      type: type === "voice" ? "audio" : type,
      rawType: message.type ?? type,
      url: clean(value.url ?? value.link),
      title: clean(value.caption ?? value.filename ?? value.id),
      name: clean(value.filename ?? value.id),
      stickerId: clean(type === "sticker" ? value.id : null),
    });
  }

  return media;
}

function messageMetadata(field, value, detail) {
  return {
    whatsapp: {
      webhookField: field,
      phoneNumberId: clean(value.metadata?.phone_number_id),
      displayPhoneNumber: clean(value.metadata?.display_phone_number),
      rawType: clean(detail?.type),
      context: detail?.context ?? null,
      referral: detail?.referral ?? null,
      errors: detail?.errors ?? null,
      pricing: detail?.pricing ?? null,
      conversation: detail?.conversation ?? null,
      status: clean(detail?.status),
    },
  };
}

function rawPayload(entry, change, value, detailKey, detail) {
  return {
    object: "whatsapp_business_account",
    entryId: clean(entry?.id),
    field: clean(change?.field),
    valueMetadata: value?.metadata ?? null,
    [detailKey]: detail,
  };
}

function normalizeIncomingMessage(entry, change, value, message, contacts) {
  const phone = clean(message.from ?? message.sender ?? message.phone);
  const senderName = contactName(contacts, phone);

  return {
    json: {
      messageId: message.id,
      conversationId: phone,
      whatsappUserId: phone,
      phone,
      phoneCountryCode: null,
      patientName: senderName,
      senderName,
      direction: "incoming",
      text: textFromMessage(message),
      timestamp: isoFromTimestamp(message.timestamp),
      media: mediaFromMessage(message),
      messageType: clean(message.type) ?? "text",
      deliveryStatus: null,
      rawPayload: rawPayload(entry, change, value, "message", message),
      messageMetadata: messageMetadata(change.field, value, message),
    },
  };
}

function normalizeStatus(entry, change, value, status) {
  const mappedStatus = deliveryStatus(status.status);
  const phone = clean(status.recipient_id ?? status.to ?? status.phone);

  return {
    json: {
      messageId: status.id,
      conversationId: clean(status.conversation?.id) ?? phone,
      whatsappUserId: phone,
      phone,
      phoneCountryCode: null,
      direction: "outgoing",
      text: "",
      timestamp: isoFromTimestamp(status.timestamp),
      deliveryStatusAt: isoFromTimestamp(status.timestamp),
      deliveryStatus: mappedStatus,
      statusOnly: true,
      rawPayload: rawPayload(entry, change, value, "status", status),
      messageMetadata: messageMetadata(change.field, value, status),
    },
  };
}

function normalizeEcho(entry, change, value, echo) {
  const phone = clean(echo.to ?? echo.recipient_id ?? echo.phone ?? echo.customer_phone);

  return {
    json: {
      messageId: echo.id ?? echo.message_id,
      conversationId: phone,
      whatsappUserId: phone,
      phone,
      phoneCountryCode: null,
      patientName: clean(echo.customer_name),
      senderName: clean(echo.sender_name) ?? "Aspects Clinica",
      direction: "outgoing",
      text: textFromMessage(echo),
      timestamp: isoFromTimestamp(echo.timestamp),
      media: mediaFromMessage(echo),
      messageType: clean(echo.type) ?? "text",
      deliveryStatus: "sent",
      rawPayload: rawPayload(entry, change, value, "message_echo", echo),
      messageMetadata: messageMetadata(change.field, value, echo),
    },
  };
}

function normalizeFlatMessage(message) {
  const phone = clean(message.phone ?? message.from ?? message.to ?? message.whatsappUserId ?? message.sender);
  const direction = message.direction === "outgoing" ? "outgoing" : "incoming";

  return {
    json: {
      messageId: message.messageId ?? message.id ?? message.message_id,
      conversationId: clean(message.conversationId) ?? phone,
      whatsappUserId: clean(message.whatsappUserId) ?? phone,
      phone,
      phoneCountryCode: clean(message.phoneCountryCode),
      patientName: clean(message.patientName ?? message.customerName),
      senderName: clean(message.senderName ?? message.patientName),
      direction,
      text: clean(message.text ?? message.body ?? message.message) ?? "",
      timestamp: isoFromTimestamp(message.timestamp ?? message.createdAt),
      media: asArray(message.media),
      messageType: clean(message.messageType ?? message.type) ?? "text",
      deliveryStatus: direction === "outgoing" ? deliveryStatus(message.deliveryStatus) : null,
      rawPayload: message,
      messageMetadata: { whatsapp: { webhookField: "flat", rawType: clean(message.type) } },
    },
  };
}

const records = [];

for (const item of inputItems) {
  const body = item.json.body ?? item.json;

  for (const entry of asArray(body.entry)) {
    for (const change of asArray(entry.changes)) {
      const value = change.value ?? {};
      const field = change.field;
      const contacts = asArray(value.contacts);

      if (field === "messages") {
        for (const message of asArray(value.messages)) {
          records.push(normalizeIncomingMessage(entry, change, value, message, contacts));
        }
        for (const status of asArray(value.statuses)) {
          records.push(normalizeStatus(entry, change, value, status));
        }
      }

      if (field === "message_echoes" || field === "smb_message_echoes") {
        const echoes = asArray(value.message_echoes ?? value.messages ?? (value.id ? value : null));
        for (const echo of echoes) {
          records.push(normalizeEcho(entry, change, value, echo));
        }
      }
    }
  }

  if (!body.entry) {
    for (const message of asArray(body.messages ?? body.message_echoes ?? (body.messageId || body.id ? body : null))) {
      records.push(normalizeFlatMessage(message));
    }
    for (const status of asArray(body.statuses)) {
      records.push(normalizeStatus(null, { field: "flat_status" }, {}, status));
    }
  }
}

return records.filter((record) => record.json.messageId);
