/**
 * n8n Code node: "Extract Meta Link Candidates"
 * Mode: Run Once for All Items
 *
 * Input: the Meta Webhook node output (`$json.body` is the normal n8n shape).
 * Output: one content-message item per Facebook/Instagram DM, suitable for the
 * Conversations API lookup. The CRM raw-capture branch remains authoritative;
 * this branch only enriches the already-captured message with a working link.
 */

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const asArray = (value) => Array.isArray(value) ? value : [];
const clean = (value) => {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
};

const output = [];

for (const [inputIndex, item] of $input.all().entries()) {
  const envelope = asObject(item.json.body ?? item.json.payload ?? item.json);
  const platform = envelope.object === "instagram" ? "instagram" : "facebook";

  for (const entry of asArray(envelope.entry)) {
    const accountId = clean(entry.id);
    const stream = [...asArray(entry.messaging), ...asArray(entry.standby)];

    for (const event of stream) {
      const message = asObject(event.message);
      const postback = asObject(event.postback);
      // Link lookup is useful for real content only. Receipts/reactions remain
      // fully captured by the parallel raw-ingest branch.
      if (!Object.keys(message).length && !Object.keys(postback).length) continue;

      const senderId = clean(asObject(event.sender).id);
      const recipientId = clean(asObject(event.recipient).id);
      const isEcho = message.is_echo === true || message.is_self === true;
      const customerId = isEcho ? recipientId : senderId;
      if (!accountId || !customerId) continue;

      output.push({
        json: {
          record_type: "message",
          event_type: Object.keys(postback).length ? "postback" : "message",
          platform,
          source: "n8n_meta_link_enrichment",
          page_id: platform === "facebook" ? accountId : null,
          instagram_account_id: platform === "instagram" ? accountId : null,
          sender_id: senderId,
          recipient_id: recipientId,
          platform_user_id: customerId,
          customer_psid: platform === "facebook" ? customerId : null,
          customer_instagram_id: platform === "instagram" ? customerId : null,
          identity_confidence: "strong",
          direction: isEcho ? "outgoing" : "incoming",
          is_echo: isEcho,
          platform_message_id: clean(message.mid ?? postback.mid),
          message_timestamp: event.timestamp ?? entry.time ?? Date.now(),
          message_text: clean(message.text ?? postback.title),
          postback_payload: clean(postback.payload),
          postback_title: clean(postback.title),
          attachments: asArray(message.attachments),
          raw_payload: event,
        },
        pairedItem: { item: inputIndex },
      });
    }
  }
}

return output;
