/**
 * Canonical shapes for Meta (Facebook / Instagram) ingestion.
 *
 * The n8n normalizers emit a flat record per event. This module defines the
 * CRM-side canonical form that the whole pipeline agrees on, so that the
 * webhook route, the persistence layer, and the UI never re-parse raw Meta
 * payloads.
 *
 * Backward compatibility: the OLD normalizer emitted `attachment_url` (single)
 * and no `event_type`. `normalize.ts` upgrades those payloads into this shape,
 * so nothing downstream needs an "old vs new" branch.
 */

export type Platform = "facebook" | "instagram";

/**
 * How sure are we that this event's actor is a specific, distinct human?
 *
 *  - `strong` — a platform-scoped ID (PSID / IG-scoped ID) exists.
 *  - `medium` — no scoped ID, but a reliable @username.
 *  - `weak`   — display name only.
 *  - `none`   — no reliable identity at all.
 *
 * Only `strong` and `medium` may create or match a lead. `weak`/`none` must
 * never drive an irreversible merge: two people can share a display name.
 */
export type IdentityConfidence = "strong" | "medium" | "weak" | "none";

/** Message-record event types. `unknown` is a first-class, storable value. */
export type MessageEventType =
  | "message"
  | "postback"
  | "referral"
  | "reaction"
  | "delivery"
  | "read"
  | "message_edit"
  | "optin"
  | "account_linking"
  | "policy_enforcement"
  | "unknown";

/** Comment-record lifecycle. */
export type CommentEventAction = "created" | "updated" | "deleted" | "unknown";

export type Direction = "incoming" | "outgoing";

export type ThreadRole = "top_level" | "reply" | "business_reply";

export interface Attachment {
  index: number;
  type: string | null;
  rawType: string | null;
  url: string | null;
  title: string | null;
  name: string | null;
  stickerId: string | null;
  payload: unknown;
}

/** The actor behind an event, after identity resolution. */
export interface Identity {
  /** Platform-scoped id when available, else a `fallback:`-style synthetic id. */
  platformUserId: string | null;
  confidence: IdentityConfidence;
  name: string | null;
  username: string | null;
  phone: string | null;
  psid: string | null;
  instagramId: string | null;
  /** True when `platformUserId` is a synthetic fallback, not a real scoped id. */
  isFallback: boolean;
}

export interface ReferralInfo {
  source: string | null;
  type: string | null;
  code: string | null;
  campaign: string | null;
  adId: string | null;
  adName: string | null;
  raw: unknown;
}

/** A normalized message-record event (record_type === "message"). */
export interface MetaMessageEvent {
  recordType: "message";
  eventType: MessageEventType;
  eventAction: string | null;
  platform: Platform;
  source: string | null;

  pageId: string | null;
  recipientPageId: string | null;
  instagramAccountId: string | null;

  identity: Identity;
  senderId: string | null;
  recipientId: string | null;

  conversationKey: string | null;
  chatLink: string | null;
  conversationLink: string | null;
  fallbackInboxLink: string | null;
  pageInboxLink: string | null;

  text: string | null;
  messageType: string | null;
  attachments: Attachment[];
  attachmentCount: number;

  direction: Direction;
  /** For status events (delivery/read): which direction the status is ABOUT. */
  statusForDirection: Direction | null;
  isEcho: boolean;
  isDeleted: boolean;
  isUnsupported: boolean;
  messageMetadata: unknown;

  platformMessageId: string | null;
  targetMessageId: string | null;
  deliveredMessageIds: string[];
  statusWatermark: string | null;

  quickReplyPayload: string | null;
  quickReplyText: string | null;
  postbackPayload: string | null;
  postbackTitle: string | null;

  reactionAction: string | null;
  reactionType: string | null;
  reactionEmoji: string | null;

  editCount: number;
  editedText: string | null;

  replyToMessageId: string | null;
  replyTo: unknown;

  facebookAppId: string | null;
  referral: ReferralInfo | null;

  sentByType: string | null;
  sentByName: string | null;

  timestamp: string;
  webhookObject: string | null;
  webhookEventKeys: unknown;
  rawPayload: unknown;

  service: string | null;
  doctor: string | null;
  branch: string | null;
}

/** A normalized comment-record event (record_type === "comment"). */
export interface MetaCommentEvent {
  recordType: "comment";
  eventType: string;
  eventAction: CommentEventAction;
  platform: Platform;
  source: string | null;

  pageId: string | null;
  instagramAccountId: string | null;

  identity: Identity;
  commenterId: string | null;
  commenterUsername: string | null;
  commenterName: string | null;

  conversationKey: string | null;
  commentThreadKey: string | null;

  commentId: string | null;
  parentCommentId: string | null;
  rawParentId: string | null;
  threadRootCommentId: string | null;
  threadRole: ThreadRole;
  isReply: boolean;

  postId: string | null;
  mediaId: string | null;

  text: string | null;
  timestamp: string;

  direction: Direction;
  isPageOrBusinessReply: boolean;
  messageType: string | null;
  commentType: string | null;
  facebookVerb: string | null;
  eventSourceField: string | null;

  isEdited: boolean;
  isDeleted: boolean;

  commentLink: string | null;
  fallbackInboxLink: string | null;
  mediaPermalink: string | null;
  mediaCaption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;

  attachments: Attachment[];
  attachmentCount: number;

  campaign: string | null;
  adId: string | null;
  adName: string | null;

  webhookObject: string | null;
  webhookChangeField: string | null;
  rawPayload: unknown;
}

export type MetaEvent = MetaMessageEvent | MetaCommentEvent;

export function isMessageEvent(e: MetaEvent): e is MetaMessageEvent {
  return e.recordType === "message";
}

export function isCommentEvent(e: MetaEvent): e is MetaCommentEvent {
  return e.recordType === "comment";
}
