/**
 * n8n Code node: "Build Meta Link Enrichment"
 * Mode: Run Once for Each Item
 *
 * Place after either Conversations API HTTP Request node. Change the upstream
 * node name below only if you used a different name in n8n.
 */

const source = $("Add Meta Inbox Fallback").item.json;
const conversation = Array.isArray($json.data) ? $json.data[0] : null;
const relativeLink = typeof conversation?.link === "string" ? conversation.link : null;
const exactLink = relativeLink
  ? new URL(relativeLink, "https://www.facebook.com").href
  : null;

return {
  json: {
    ...source,
    conversation_key: conversation?.id ?? source.conversation_key ?? null,
    conversation_link: exactLink,
    // Backward compatibility with older CRM deployments. The current CRM
    // prefers conversation_link over chat_link.
    chat_link: exactLink,
    fallback_inbox_link: source.fallback_inbox_link ?? null,
    page_inbox_link: source.page_inbox_link ?? null,
  },
};
