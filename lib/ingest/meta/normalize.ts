/**
 * Payload normalization: anything Meta or n8n can send us → `MetaEvent[]`.
 *
 * Four input shapes are accepted, because the ingestion endpoint must never be
 * the reason a webhook fails:
 *
 *  1. A single flat record from the NEW n8n normalizer.
 *  2. A single flat record from the OLD normalizer (no `event_type`, a single
 *     `attachment_url` instead of an `attachments` array).
 *  3. An array of either, or `{records|events|data: [...]}`.
 *  4. A raw Meta webhook envelope: `{object, entry:[{messaging:[…], changes:[…]}]}`
 *     with multiple entries, multiple messaging events per entry, and multiple
 *     changes per entry.
 *
 * Unrecognised event types normalize to `event_type: "unknown"` and are stored,
 * never rejected. Nothing in this module throws on malformed input.
 */

import {
  type Attachment,
  type CommentEventAction,
  type Direction,
  type MetaCommentEvent,
  type MetaEvent,
  type MetaMessageEvent,
  type MessageEventType,
  type Platform,
  type ReferralInfo,
  type ThreadRole,
} from "./types";
import { resolveIdentity } from "./identity";
import { buildMetaBusinessSuiteLink } from "./businessSuiteLinks";

/* ── tiny, total accessors ──────────────────────────────────────────────── */

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

function str(o: Rec, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

function bool(o: Rec, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return false;
}

function int(o: Rec, ...keys: string[]): number {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  }
  return 0;
}

function list(o: Rec, ...keys: string[]): unknown[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function strList(o: Rec, ...keys: string[]): string[] {
  return list(o, ...keys).filter((v): v is string => typeof v === "string" && v !== "");
}

/**
 * Meta sends epoch milliseconds; the normalizers may send ISO. Anything
 * unparseable degrades to "now" rather than poisoning the row with `Invalid Date`.
 */
export function toIso(value: unknown, fallback: () => Date = () => new Date()): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: 10-digit values are seconds, 13-digit are milliseconds.
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && value.trim() === String(n)) return toIso(n, fallback);
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallback().toISOString();
}

/* ── platform + event type ──────────────────────────────────────────────── */

function toPlatform(o: Rec): Platform {
  const p = (str(o, "platform", "source") ?? "").toLowerCase();
  if (p.includes("instagram")) return "instagram";
  if (p.includes("facebook") || p.includes("messenger")) return "facebook";
  const obj = (str(o, "webhook_object") ?? "").toLowerCase();
  if (obj === "instagram") return "instagram";
  if (o["instagram_account_id"]) return "instagram";
  return "facebook";
}

const MESSAGE_EVENT_TYPES: MessageEventType[] = [
  "message",
  "postback",
  "referral",
  "reaction",
  "delivery",
  "read",
  "message_edit",
  "optin",
  "account_linking",
  "policy_enforcement",
  "unknown",
];

/**
 * Determine the event type. When the payload declares one we honour it (after
 * validating it against the known set). When it does not — the OLD normalizer
 * never emitted `event_type` — we infer from the fields that are present, which
 * for an old payload always yields `"message"`.
 */
function toMessageEventType(o: Rec): MessageEventType {
  const declared = (str(o, "event_type") ?? "").toLowerCase();
  if (declared && (MESSAGE_EVENT_TYPES as string[]).includes(declared)) {
    return declared as MessageEventType;
  }
  if (declared) return "unknown"; // a type we have never heard of — store it.

  if (o["reaction_action"] || o["reaction_type"] || o["reaction_emoji"]) return "reaction";
  if (o["delivered_message_ids"]) return "delivery";
  if (o["postback_payload"] || o["postback_title"]) return "postback";
  if (o["edited_text"] || o["edit_count"]) return "message_edit";
  if (o["referral"] || o["referral_source"] || o["referral_type"]) {
    // A referral ATTACHED to a message is still a message; a standalone one is not.
    const hasContent = !!str(o, "message_text") || list(o, "attachments").length > 0 || !!o["attachment_url"];
    return hasContent ? "message" : "referral";
  }
  return "message";
}

function toDirection(o: Rec, isEcho: boolean): Direction {
  // Platform echo/self flags are authoritative. A stale n8n `direction` value
  // must never turn the clinic's own sent message into incoming patient work.
  if (isEcho) return "outgoing";
  const d = (str(o, "direction") ?? "").toLowerCase();
  if (d === "outgoing" || d === "outbound") return "outgoing";
  if (d === "incoming" || d === "inbound") return "incoming";
  const sentBy = (str(o, "sent_by_type") ?? "").toLowerCase();
  if (sentBy === "page" || sentBy === "business" || sentBy === "admin") return "outgoing";
  return "incoming";
}

function toStatusDirection(o: Rec): Direction | null {
  const d = (str(o, "status_for_direction") ?? "").toLowerCase();
  if (d === "outgoing" || d === "outbound") return "outgoing";
  if (d === "incoming" || d === "inbound") return "incoming";
  return null;
}

/* ── attachments ────────────────────────────────────────────────────────── */

/**
 * Accepts the new `attachments: [...]` array, the old scalar `attachment_url`,
 * and Meta's native `{type, payload:{url, sticker_id}}` shape. Ordering is
 * preserved and index-stamped, because "the third photo" must stay third.
 */
export function toAttachments(o: Rec): Attachment[] {
  const raw = list(o, "attachments");
  if (raw.length > 0) {
    return raw.filter(isRec).map((a, i) => {
      const payload = isRec(a["payload"]) ? (a["payload"] as Rec) : null;
      return {
        index: typeof a["index"] === "number" ? (a["index"] as number) : i,
        type: str(a, "type"),
        rawType: str(a, "raw_type", "type"),
        url: str(a, "url") ?? (payload ? str(payload, "url") : null),
        title: str(a, "title"),
        name: str(a, "name"),
        stickerId: str(a, "sticker_id") ?? (payload ? str(payload, "sticker_id") : null),
        payload: a["payload"] ?? null,
      } satisfies Attachment;
    });
  }

  // OLD payload compatibility: one attachment, expressed as a bare URL.
  const url = str(o, "attachment_url");
  if (url) {
    return [
      {
        index: 0,
        type: str(o, "message_type") ?? "file",
        rawType: str(o, "message_type"),
        url,
        title: null,
        name: null,
        stickerId: null,
        payload: null,
      },
    ];
  }
  return [];
}

/** Derive a message_type when the payload omits one. */
function toMessageType(o: Rec, attachments: Attachment[], text: string | null): string | null {
  const declared = str(o, "message_type");
  if (declared) return declared;
  if (attachments.length > 0) return attachments[0].type ?? "attachment";
  if (text) return "text";
  return null;
}

/* ── referral ───────────────────────────────────────────────────────────── */

function toReferral(o: Rec): ReferralInfo | null {
  const nested = isRec(o["referral"]) ? (o["referral"] as Rec) : null;
  const source = str(o, "referral_source") ?? (nested ? str(nested, "source") : null);
  const type = str(o, "referral_type") ?? (nested ? str(nested, "type") : null);
  const code = str(o, "referral_code") ?? (nested ? str(nested, "ref") : null);
  const adId = str(o, "ad_id") ?? (nested ? str(nested, "ad_id") : null);
  const adName = str(o, "ad_name") ?? (nested ? str(nested, "ad_name") : null);
  const campaign = str(o, "campaign") ?? (nested ? str(nested, "campaign") : null);

  if (!source && !type && !code && !adId && !adName && !campaign && !nested) return null;
  return { source, type, code, campaign, adId, adName, raw: o["referral"] ?? null };
}

/* ── comments ───────────────────────────────────────────────────────────── */

const COMMENT_ACTIONS: CommentEventAction[] = ["created", "updated", "deleted", "unknown"];

function toCommentAction(o: Rec): CommentEventAction {
  const declared = (str(o, "event_action") ?? "").toLowerCase();
  if ((COMMENT_ACTIONS as string[]).includes(declared)) return declared as CommentEventAction;

  // Facebook expresses the lifecycle through `verb`.
  const verb = (str(o, "facebook_verb") ?? "").toLowerCase();
  if (verb === "add") return "created";
  if (verb === "edited" || verb === "edit") return "updated";
  if (verb === "remove" || verb === "delete") return "deleted";

  if (bool(o, "is_deleted")) return "deleted";
  if (bool(o, "is_edited")) return "updated";
  if (declared) return "unknown";
  return "created";
}

function toThreadRole(o: Rec, isReply: boolean, isBusiness: boolean): ThreadRole {
  const declared = (str(o, "thread_role") ?? "").toLowerCase();
  if (declared === "top_level" || declared === "reply" || declared === "business_reply") {
    return declared as ThreadRole;
  }
  if (isBusiness) return "business_reply";
  return isReply ? "reply" : "top_level";
}

function isCommentRecord(o: Rec): boolean {
  const rt = (str(o, "record_type") ?? "").toLowerCase();
  if (rt === "comment") return true;
  if (rt === "message") return false;
  return !!(o["comment_id"] || o["comment_thread_key"] || o["comment_text"] || o["webhook_change_field"]);
}

/* ── the two normalizers ────────────────────────────────────────────────── */

function normalizeMessage(input: Rec, now: () => Date): MetaMessageEvent {
  // n8n normalizers sometimes preserve the complete Meta event under
  // `raw_payload` while omitting critical top-level fields such as `mid`,
  // sender and recipient. Recover those fields before canonicalizing so a
  // message can always be targeted by echoes, reads, deliveries and reactions.
  const raw = isRec(input["raw_payload"]) ? (input["raw_payload"] as Rec) : null;
  const rawLooksNative = raw && (
    isRec(raw["sender"]) || isRec(raw["recipient"]) || isRec(raw["message"]) ||
    isRec(raw["delivery"]) || isRec(raw["read"]) || isRec(raw["reaction"])
  );
  const recovered = rawLooksNative
    ? messagingToFlat(
        raw,
        { id: str(input, "page_id", "instagram_account_id") },
        str(input, "webhook_object") ?? (toPlatform(input) === "instagram" ? "instagram" : "page"),
      )
    : {};
  const o: Rec = { ...input };
  for (const [field, value] of Object.entries(recovered)) {
    if (o[field] === null || o[field] === undefined || o[field] === "") o[field] = value;
  }
  // Echo direction is platform truth; a normalizer must not turn a clinic reply
  // into a second incoming patient message.
  if (recovered["is_echo"] === true) {
    o["is_echo"] = true;
    o["direction"] = "outgoing";
    o["platform_user_id"] = recovered["platform_user_id"];
  }
  const platform = toPlatform(o);
  // Instagram test/self messages may use `is_self` instead of `is_echo`.
  // Both mean the clinic sent the message and must never become incoming work.
  const isEcho = bool(o, "is_echo", "is_self");
  const attachments = toAttachments(o);
  const text = str(o, "message_text", "text");
  const eventType = toMessageEventType(o);
  const direction = toDirection(o, isEcho);
  const senderUsername = str(o, "sender_username");
  const senderName = str(o, "sender_name");
  const explicitPlatformUserId =
    str(o, "platform_user_id") ??
    str(o, "customer_psid") ??
    str(o, "customer_instagram_id") ??
    // For outgoing/echo events the customer is the RECIPIENT, not the sender.
    (direction === "outgoing" ? str(o, "recipient_id") : str(o, "sender_id"));
  const safeFallbackId = explicitPlatformUserId ?? (
    platform === "instagram" && senderUsername
      ? `instagram_username:${senderUsername.toLowerCase()}`
      : platform === "facebook" && senderName
        ? `facebook_name:${senderName}`
        : null
  );

  const identity = resolveIdentity({
    platform,
    platformUserId: safeFallbackId,
    declaredConfidence: str(o, "identity_confidence"),
    name: senderName,
    username: senderUsername,
    phone: str(o, "sender_phone"),
    psid: str(o, "customer_psid"),
    instagramId: str(o, "customer_instagram_id"),
  });
  const pageId = str(o, "page_id");
  const recipientPageId = str(o, "recipient_page_id");
  const selectedItemId =
    str(o, "selected_item_id", "business_suite_selected_item_id") ??
    (identity.isFallback ? null : identity.platformUserId);
  const generatedConversationLink = buildMetaBusinessSuiteLink({
    platform,
    kind: "message",
    selectedItemId,
  });
  const generatedInboxLink = buildMetaBusinessSuiteLink({
    platform,
    kind: "message",
  });

  return {
    recordType: "message",
    eventType,
    eventAction: str(o, "event_action"),
    platform,
    source: str(o, "source"),

    pageId,
    recipientPageId,
    instagramAccountId: str(o, "instagram_account_id"),

    identity,
    senderId: str(o, "sender_id"),
    recipientId: str(o, "recipient_id"),

    conversationKey: str(o, "conversation_key"),
    chatLink: str(o, "chat_link"),
    conversationLink: selectedItemId ? generatedConversationLink : (str(o, "conversation_link") ?? generatedConversationLink),
    fallbackInboxLink: str(o, "fallback_inbox_link") ?? generatedInboxLink,
    pageInboxLink: str(o, "page_inbox_link") ?? generatedInboxLink,

    text,
    messageType: toMessageType(o, attachments, text),
    attachments,
    attachmentCount: attachments.length || int(o, "attachment_count"),

    direction,
    statusForDirection: toStatusDirection(o),
    isEcho,
    isDeleted: bool(o, "message_is_deleted"),
    isUnsupported: bool(o, "message_is_unsupported"),
    messageMetadata: o["message_metadata"] ?? null,

    platformMessageId: str(o, "platform_message_id", "mid"),
    targetMessageId: str(o, "target_message_id"),
    deliveredMessageIds: strList(o, "delivered_message_ids"),
    statusWatermark: o["status_watermark"] ? toIso(o["status_watermark"], now) : null,

    quickReplyPayload: str(o, "quick_reply_payload"),
    quickReplyText: str(o, "quick_reply_text"),
    postbackPayload: str(o, "postback_payload"),
    postbackTitle: str(o, "postback_title"),

    reactionAction: str(o, "reaction_action"),
    reactionType: str(o, "reaction_type"),
    reactionEmoji: str(o, "reaction_emoji"),

    editCount: int(o, "edit_count"),
    editedText: str(o, "edited_text"),

    replyToMessageId:
      str(o, "reply_to_message_id") ??
      (isRec(o["reply_to"]) ? str(o["reply_to"] as Rec, "mid", "message_id") : null),
    replyTo: o["reply_to"] ?? null,

    facebookAppId: str(o, "facebook_app_id"),
    referral: toReferral(o),

    sentByType: str(o, "sent_by_type"),
    sentByName: str(o, "sent_by_name", "sender_name"),

    timestamp: toIso(o["message_timestamp"] ?? o["timestamp"], now),
    webhookObject: str(o, "webhook_object"),
    webhookEventKeys: o["webhook_event_keys"] ?? null,
    rawPayload: o["raw_payload"] ?? o,

    service: str(o, "service"),
    doctor: str(o, "doctor"),
    branch: str(o, "branch"),
  };
}

function normalizeComment(input: Rec, now: () => Date): MetaCommentEvent {
  // n8n often preserves the native Meta change under `raw_payload` while
  // flattening only some fields. Recover omitted IDs/text/account metadata
  // first, then let explicit n8n fields win.
  const raw = isRec(input["raw_payload"]) ? (input["raw_payload"] as Rec) : null;
  const rawValue = raw && isRec(raw["value"]) ? (raw["value"] as Rec) : raw;
  const rawLooksNative = rawValue && (
    isRec(rawValue["from"]) || isRec(rawValue["media"]) ||
    rawValue["comment_id"] !== undefined || rawValue["id"] !== undefined ||
    rawValue["message"] !== undefined || rawValue["text"] !== undefined
  );
  const recovered = rawLooksNative
    ? changeToFlat(
        raw && isRec(raw["value"])
          ? raw
          : { field: str(input, "webhook_change_field", "event_source_field"), value: rawValue },
        { id: str(input, "instagram_account_id", "page_id"), time: input["comment_timestamp"] ?? input["timestamp"] },
        str(input, "webhook_object") ?? (toPlatform(input) === "instagram" ? "instagram" : "page"),
      )
    : {};
  const o: Rec = { ...recovered };
  for (const [field, value] of Object.entries(input)) {
    if (value !== null && value !== undefined && value !== "") o[field] = value;
  }

  const platform = toPlatform(o);
  const attachments = toAttachments(o);
  const actorId = str(o, "commenter_id", "platform_user_id");
  const accountId = platform === "instagram" ? str(o, "instagram_account_id") : str(o, "page_id");
  const isBusiness = bool(o, "is_page_or_business_reply", "is_self") || Boolean(actorId && accountId && actorId === accountId);

  const parentCommentId = str(o, "parent_comment_id");
  const declaredIsReply = o["is_reply"] !== undefined ? bool(o, "is_reply") : !!parentCommentId;
  const commentId = str(o, "comment_id");
  const action = toCommentAction(o);

  const commenterUsername = str(o, "commenter_username");
  const commenterName = str(o, "commenter_name");
  const explicitCommenterId = str(o, "platform_user_id", "commenter_id");
  const safeCommenterId = explicitCommenterId ?? (
    platform === "instagram" && commenterUsername
      ? `instagram_username:${commenterUsername.toLowerCase()}`
      : platform === "facebook" && commenterName
        ? `facebook_name:${commenterName}`
        : null
  );

  const identity = resolveIdentity({
    platform,
    platformUserId: safeCommenterId,
    declaredConfidence: str(o, "identity_confidence"),
    name: commenterName,
    username: commenterUsername,
  });
  const pageId = str(o, "page_id");
  const instagramAccountId = str(o, "instagram_account_id");
  const postId = str(o, "post_id");
  const mediaId = str(o, "media_id");
  const adId = str(o, "ad_id");
  const selectedItemId =
    str(o, "selected_item_id", "business_suite_selected_item_id") ??
    (platform === "instagram"
      ? (mediaId ?? postId ?? str(o, "thread_root_comment_id") ?? commentId)
      : (postId ?? str(o, "thread_root_comment_id") ?? commentId));
  const generatedCommentLink = buildMetaBusinessSuiteLink({
    platform,
    kind: "comment",
    selectedItemId,
    adId,
    threadType: str(o, "thread_type", "business_suite_thread_type"),
  });

  return {
    recordType: "comment",
    eventType: str(o, "event_type") ?? "comment",
    eventAction: action,
    platform,
    source: str(o, "source"),

    pageId,
    instagramAccountId,

    identity,
    commenterId: str(o, "commenter_id"),
    commenterUsername: str(o, "commenter_username"),
    commenterName: str(o, "commenter_name"),

    conversationKey: str(o, "conversation_key"),
    commentThreadKey: str(o, "comment_thread_key"),

    commentId,
    parentCommentId,
    rawParentId: str(o, "raw_parent_id"),
    // A top-level comment is the root of its own thread.
    threadRootCommentId: str(o, "thread_root_comment_id") ?? (declaredIsReply ? parentCommentId : commentId),
    threadRole: toThreadRole(o, declaredIsReply, isBusiness),
    isReply: declaredIsReply,

    postId,
    mediaId,

    text: str(o, "comment_text", "message_text"),
    timestamp: toIso(o["comment_timestamp"] ?? o["message_timestamp"] ?? o["timestamp"], now),

    direction: isBusiness ? "outgoing" : toDirection(o, false),
    isPageOrBusinessReply: isBusiness,
    messageType: str(o, "message_type"),
    commentType: str(o, "comment_type"),
    facebookVerb: str(o, "facebook_verb"),
    eventSourceField: str(o, "event_source_field"),

    isEdited: bool(o, "is_edited") || action === "updated",
    isDeleted: bool(o, "is_deleted") || action === "deleted",

    commentLink: selectedItemId ? generatedCommentLink : (str(o, "comment_link") ?? generatedCommentLink),
    // Comment-only leads use this field for the drawer's "Open source" link;
    // keep it as the exact Business Suite thread rather than a generic inbox.
    fallbackInboxLink: selectedItemId ? generatedCommentLink : (str(o, "fallback_inbox_link") ?? generatedCommentLink),
    mediaPermalink: str(o, "media_permalink"),
    mediaCaption: str(o, "media_caption"),
    mediaType: str(o, "media_type"),
    mediaProductType: str(o, "media_product_type"),

    attachments,
    attachmentCount: attachments.length || int(o, "attachment_count"),

    campaign: str(o, "campaign"),
    adId,
    adName: str(o, "ad_name"),

    webhookObject: str(o, "webhook_object"),
    webhookChangeField: str(o, "webhook_change_field"),
    rawPayload: o["raw_payload"] ?? o,
  };
}

/* ── raw Meta envelope → flat records ───────────────────────────────────── */

/**
 * Convert one native Meta `messaging` entry into the flat shape the normalizers
 * would have produced. Only used when the caller posts a raw webhook envelope.
 */
function messagingToFlat(m: Rec, entry: Rec, webhookObject: string | null): Rec {
  const sender = isRec(m["sender"]) ? (m["sender"] as Rec) : {};
  const recipient = isRec(m["recipient"]) ? (m["recipient"] as Rec) : {};
  const message = isRec(m["message"]) ? (m["message"] as Rec) : null;
  const postback = isRec(m["postback"]) ? (m["postback"] as Rec) : null;
  const reaction = isRec(m["reaction"]) ? (m["reaction"] as Rec) : null;
  const delivery = isRec(m["delivery"]) ? (m["delivery"] as Rec) : null;
  const read = isRec(m["read"]) ? (m["read"] as Rec) : null;
  const referral = isRec(m["referral"]) ? (m["referral"] as Rec) : null;
  const messageEdit = isRec(m["message_edit"]) ? (m["message_edit"] as Rec) : null;
  const quickReply = message && isRec(message["quick_reply"]) ? (message["quick_reply"] as Rec) : null;
  const replyTo = message && isRec(message["reply_to"]) ? (message["reply_to"] as Rec) : null;

  const isEcho = !!(message && (message["is_echo"] === true || message["is_self"] === true));

  let eventType: MessageEventType = "unknown";
  if (message) eventType = "message";
  else if (postback) eventType = "postback";
  else if (reaction) eventType = "reaction";
  else if (delivery) eventType = "delivery";
  else if (read) eventType = "read";
  else if (messageEdit) eventType = "message_edit";
  else if (referral) eventType = "referral";
  else if (m["optin"]) eventType = "optin";
  else if (m["account_linking"]) eventType = "account_linking";
  else if (m["policy_enforcement"]) eventType = "policy_enforcement";

  const pageId = str(entry, "id");
  const customerId = isEcho ? str(recipient, "id") : str(sender, "id");

  const flat: Rec = {
    record_type: "message",
    event_type: eventType,
    webhook_object: webhookObject,
    webhook_event_keys: Object.keys(m),
    platform: webhookObject === "instagram" ? "instagram" : "facebook",
    page_id: webhookObject === "instagram" ? null : pageId,
    instagram_account_id: webhookObject === "instagram" ? pageId : null,
    sender_id: str(sender, "id"),
    recipient_id: str(recipient, "id"),
    platform_user_id: customerId,
    selected_item_id: str(m, "selected_item_id") ?? (message ? str(message, "selected_item_id") : null),
    thread_type: str(m, "thread_type") ?? (message ? str(message, "thread_type") : null),
    message_timestamp: m["timestamp"] ?? null,
    is_echo: isEcho,
    direction: isEcho ? "outgoing" : "incoming",
    raw_payload: m,
  };

  if (message) {
    flat["platform_message_id"] = message["mid"] ?? null;
    flat["message_text"] = message["text"] ?? null;
    flat["attachments"] = message["attachments"] ?? [];
    flat["message_is_deleted"] = message["is_deleted"] ?? false;
    flat["message_is_unsupported"] = message["is_unsupported"] ?? false;
    flat["is_self"] = message["is_self"] ?? false;
    if (quickReply) {
      flat["quick_reply_payload"] = quickReply["payload"] ?? null;
      flat["quick_reply_text"] = message["text"] ?? null;
    }
    if (replyTo) flat["reply_to"] = replyTo;
    if (isRec(message["referral"])) flat["referral"] = message["referral"];
  }
  if (postback) {
    flat["postback_payload"] = postback["payload"] ?? null;
    flat["postback_title"] = postback["title"] ?? null;
    flat["platform_message_id"] = postback["mid"] ?? null;
    if (isRec(postback["referral"])) flat["referral"] = postback["referral"];
  }
  if (reaction) {
    flat["reaction_action"] = reaction["action"] ?? null;
    flat["reaction_type"] = reaction["reaction"] ?? null;
    flat["reaction_emoji"] = reaction["emoji"] ?? null;
    flat["target_message_id"] = reaction["mid"] ?? null;
  }
  if (delivery) {
    flat["delivered_message_ids"] = delivery["mids"] ?? [];
    flat["status_watermark"] = delivery["watermark"] ?? null;
    flat["status_for_direction"] = "outgoing";
  }
  if (read) {
    flat["status_watermark"] = read["watermark"] ?? null;
    flat["target_message_id"] = read["mid"] ?? null;
    flat["status_for_direction"] = "outgoing";
  }
  if (messageEdit) {
    flat["platform_message_id"] = messageEdit["mid"] ?? null;
    flat["target_message_id"] = messageEdit["mid"] ?? null;
    flat["edited_text"] = messageEdit["text"] ?? null;
    flat["edit_count"] = messageEdit["num_edit"] ?? 1;
    flat["event_action"] = "updated";
  }
  if (referral) flat["referral"] = referral;

  return flat;
}

/** Convert one native Meta `changes` entry (a comment) into the flat shape. */
function changeToFlat(c: Rec, entry: Rec, webhookObject: string | null): Rec {
  const value = isRec(c["value"]) ? (c["value"] as Rec) : {};
  const from = isRec(value["from"]) ? (value["from"] as Rec) : {};
  const parent = isRec(value["parent"]) ? (value["parent"] as Rec) : null;
  const media = isRec(value["media"]) ? (value["media"] as Rec) : null;
  const post = isRec(value["post"]) ? (value["post"] as Rec) : null;
  const accountId = str(entry, "id");
  const actorId = str(from, "id");
  const isInstagram = webhookObject === "instagram";
  const isBusinessReply = Boolean(
    bool(value, "is_page_or_business_reply", "is_self") ||
    str(from, "self_ig_scoped_id") ||
    (accountId && actorId && accountId === actorId),
  );

  return {
    record_type: "comment",
    event_type: "comment",
    webhook_object: webhookObject,
    webhook_change_field: str(c, "field"),
    event_source_field: str(c, "field"),
    platform: webhookObject === "instagram" ? "instagram" : "facebook",
    page_id: isInstagram ? null : accountId,
    instagram_account_id: isInstagram ? accountId : null,
    facebook_verb: str(value, "verb"),
    comment_id: str(value, "comment_id", "id"),
    parent_comment_id: parent ? str(parent, "id") : str(value, "parent_id"),
    raw_parent_id: str(value, "parent_id"),
    post_id: str(value, "post_id") ?? (post ? str(post, "id") : null),
    media_id: media ? str(media, "id") : null,
    selected_item_id: str(value, "selected_item_id"),
    thread_type: str(value, "thread_type"),
    ad_id: str(value, "ad_id"),
    media_product_type: media ? str(media, "media_product_type") : null,
    commenter_id: str(from, "id"),
    commenter_name: str(from, "name"),
    commenter_username: str(from, "username"),
    platform_user_id: str(from, "id"),
    is_page_or_business_reply: isBusinessReply,
    direction: isBusinessReply ? "outgoing" : "incoming",
    comment_text: str(value, "message", "text"),
    comment_timestamp: value["created_time"] ?? entry["time"] ?? null,
    comment_link: str(value, "permalink_url"),
    raw_payload: c,
  };
}

/** Flatten any accepted body shape into candidate flat records. */
export function collectRecords(body: unknown): Rec[] {
  if (Array.isArray(body)) return body.filter(isRec).flatMap((b) => collectRecords(b));
  if (!isRec(body)) return [];

  // Raw Meta webhook envelope.
  if (Array.isArray(body["entry"])) {
    const webhookObject = str(body, "object");
    const out: Rec[] = [];
    for (const e of (body["entry"] as unknown[]).filter(isRec)) {
      for (const m of list(e, "messaging", "standby").filter(isRec)) {
        out.push(messagingToFlat(m, e, webhookObject));
      }
      for (const c of list(e, "changes").filter(isRec)) {
        out.push(changeToFlat(c, e, webhookObject));
      }
      // Meta also sends Instagram comments as entry-level `{field, value}`
      // notifications with no `changes` array. This is the documented shape
      // for some comments/live_comments deliveries.
      if (list(e, "changes").length === 0 && str(e, "field") && isRec(e["value"])) {
        out.push(changeToFlat({ field: e["field"], value: e["value"] }, e, webhookObject));
      }
    }
    return out;
  }

  // The n8n Webhook node wraps the incoming request under `body`. Accept the
  // complete n8n item as well as `$json.body`; older flows used `payload` or
  // `webhook` for the same purpose.
  for (const k of ["body", "payload", "webhook"]) {
    if (isRec(body[k])) return collectRecords(body[k]);
    if (typeof body[k] === "string") {
      try {
        return collectRecords(JSON.parse(body[k] as string));
      } catch {
        // Preserve the outer record below instead of throwing ingestion away.
      }
    }
  }

  for (const k of ["records", "events", "data", "items"]) {
    if (Array.isArray(body[k])) return (body[k] as unknown[]).filter(isRec).flatMap((b) => collectRecords(b));
  }

  return [body];
}

/** The public entry point: any body → zero or more canonical events. */
export function toEvents(body: unknown, now: () => Date = () => new Date()): MetaEvent[] {
  return collectRecords(body).map((r) =>
    isCommentRecord(r) ? normalizeComment(r, now) : normalizeMessage(r, now),
  );
}
