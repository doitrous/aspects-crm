/**
 * Deterministic idempotency keys.
 *
 * Meta retries webhooks. A retry is byte-identical to the original except for
 * its arrival time, so a key derived from anything time-of-receipt-related
 * (`received_at`, `now()`, a generated uuid) would let duplicates through.
 * Every key here is built ONLY from stable, platform-supplied identifiers.
 *
 * The keys are stored in unique-indexed columns, so a retry that slips past an
 * in-app existence check still cannot insert a second row — the database is the
 * final arbiter, not the application.
 */

import { createHash } from "node:crypto";
import { isMessageEvent, type MetaEvent, type MetaMessageEvent } from "./types";

/** Join parts stably; hash only to bound the column length. */
function key(...parts: (string | number | null | undefined)[]): string {
  const raw = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
  if (raw.length <= 180) return raw;
  return `h:${createHash("sha256").update(raw).digest("hex")}`;
}

/**
 * The key for a content message. Prefers the platform's own message id; falls
 * back to a content-derived key when Meta omits one (rare, but a missing id
 * must not mean "insert a duplicate on every retry").
 */
export function messageKey(e: MetaMessageEvent): string {
  if (e.platformMessageId) return key("msg", e.platform, e.platformMessageId);
  return key(
    "msg",
    e.platform,
    e.eventType,
    e.identity.platformUserId,
    e.conversationKey,
    e.timestamp,
    e.text,
    e.attachments.map((a) => a.url ?? a.payload ?? a.stickerId ?? "").join(","),
    e.postbackPayload,
    e.quickReplyPayload,
  );
}

export function commentKey(platform: string, commentId: string | null, fallback: string[] = []): string {
  if (commentId) return key("cmt", platform, commentId);
  return key("cmt", platform, ...fallback);
}

/** An edit is identified by which message it edits and which revision it is. */
export function editKey(e: MetaMessageEvent): string {
  return key(
    "edit",
    e.platform,
    e.targetMessageId ?? e.platformMessageId,
    e.editCount,
  );
}

/**
 * A reaction is identified by target + actor + action + value + when.
 * `unreact` must be distinct from `react` so removing and re-adding the same
 * emoji is two auditable events, not one collapsed row.
 */
export function reactionKey(e: MetaMessageEvent): string {
  return key(
    "rxn",
    e.platform,
    e.targetMessageId,
    e.identity.platformUserId,
    e.reactionAction,
    e.reactionType,
    e.reactionEmoji,
    e.timestamp,
  );
}

/**
 * Delivery/read receipts. When explicit message ids are present they identify
 * the event; otherwise the watermark does.
 */
export function receiptKey(e: MetaMessageEvent): string {
  const ids = e.deliveredMessageIds.length ? [...e.deliveredMessageIds].sort().join(",") : null;
  return key(
    "rcpt",
    e.eventType,
    e.platform,
    e.conversationKey ?? e.identity.platformUserId,
    e.targetMessageId,
    ids,
    e.statusWatermark,
  );
}

/** A referral is identified by who, from where, and when. */
export function referralKey(e: MetaMessageEvent): string {
  return key(
    "ref",
    e.platform,
    e.identity.platformUserId,
    e.referral?.source,
    e.referral?.type,
    e.referral?.code,
    e.referral?.adId,
    e.timestamp,
  );
}

/** Anything we do not specifically understand still needs a stable key. */
export function genericEventKey(e: MetaMessageEvent): string {
  return key(
    "evt",
    e.eventType,
    e.platform,
    e.identity.platformUserId,
    e.conversationKey,
    e.platformMessageId,
    e.timestamp,
    // Last resort: the payload itself. Identical retries hash identically.
    e.rawPayload ? createHash("sha256").update(JSON.stringify(e.rawPayload)).digest("hex").slice(0, 32) : null,
  );
}

/** The single key used to dedupe whatever this event is. */
export function eventKey(event: MetaEvent): string {
  if (!isMessageEvent(event)) {
    return commentKey(event.platform, event.commentId, [
      event.eventAction,
      event.identity.platformUserId ?? "",
      event.timestamp,
    ]);
  }
  switch (event.eventType) {
    case "message":
    case "postback":
      return messageKey(event);
    case "message_edit":
      return editKey(event);
    case "reaction":
      return reactionKey(event);
    case "delivery":
    case "read":
      return receiptKey(event);
    case "referral":
      return referralKey(event);
    default:
      return genericEventKey(event);
  }
}
