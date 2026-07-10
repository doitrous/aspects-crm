/**
 * Event semantics — the one place that decides what an event is ALLOWED to do.
 *
 * Every downstream rule the spec cares about (unread, SLA, lead creation, KPI
 * counting, chat-bubble rendering) is derived here from `event_type`, never
 * from `direction` alone. A `read` receipt carries `direction: "incoming"` on
 * some Meta payloads even though nothing was said; trusting `direction` there
 * would fabricate an unread patient message out of the patient reading OUR
 * reply. So: event type first, `status_for_direction` second, `direction` last.
 */

import { isMessageEvent, type MetaEvent } from "./types";

export interface EventSemantics {
  /** Inserts a row into `crm_messages` (a real chat bubble). */
  createsMessageRow: boolean;
  /** Mutates an existing `crm_messages` row rather than inserting one. */
  mutatesExistingMessage: boolean;
  /** Belongs in `crm_conversation_events` (never a bubble). */
  isConversationEvent: boolean;
  /** Counts toward "Total Messages" and the incoming-message KPIs. */
  countsAsIncomingMessage: boolean;
  /** May mark the lead unread. */
  affectsUnread: boolean;
  /** May start or reset the reply-SLA timer. */
  affectsSla: boolean;
  /** May create a brand-new lead (subject to identity confidence). */
  mayCreateLead: boolean;
  /** Should be surfaced as a system/timeline card, not a patient bubble. */
  isTimelineEvent: boolean;
}

/** Message event types that produce a visible chat bubble. */
const CONTENT_EVENTS = new Set(["message", "postback"]);

/** Message event types that never produce a bubble and never touch unread/SLA. */
const STATUS_EVENTS = new Set([
  "delivery",
  "read",
  "reaction",
  "referral",
  "optin",
  "account_linking",
  "policy_enforcement",
  "unknown",
]);

const INERT: EventSemantics = {
  createsMessageRow: false,
  mutatesExistingMessage: false,
  isConversationEvent: true,
  countsAsIncomingMessage: false,
  affectsUnread: false,
  affectsSla: false,
  mayCreateLead: false,
  isTimelineEvent: false,
};

export function classify(event: MetaEvent): EventSemantics {
  if (!isMessageEvent(event)) {
    // ── Comments ─────────────────────────────────────────────────────────
    // A newly created, inbound customer comment is genuine content and may
    // create a lead. Edits and deletions mutate an existing comment: they are
    // not new content, must not re-mark the lead unread, and must not restart
    // the SLA clock (the moderator may have already replied).
    const created = event.eventAction === "created";
    const inbound = event.direction === "incoming" && !event.isPageOrBusinessReply;
    return {
      createsMessageRow: false,
      mutatesExistingMessage: event.eventAction === "updated" || event.eventAction === "deleted",
      isConversationEvent: false,
      countsAsIncomingMessage: created && inbound,
      affectsUnread: created && inbound,
      affectsSla: created && inbound,
      mayCreateLead: created && inbound,
      isTimelineEvent: false,
    };
  }

  // ── Messages ───────────────────────────────────────────────────────────
  const t = event.eventType;

  if (t === "message_edit") {
    // Updates the original bubble in place. Never a new message, never unread.
    return { ...INERT, isConversationEvent: false, mutatesExistingMessage: true };
  }

  if (t === "referral") {
    // Attribution + a timeline card ("Lead entered from Facebook Ad").
    // It MAY create a lead, but only when it carries a usable identity — that
    // gate lives in `identity.canIdentifyLead`, applied by the persist layer.
    return { ...INERT, isTimelineEvent: true, mayCreateLead: true };
  }

  if (STATUS_EVENTS.has(t)) {
    // delivery / read / reaction / optin / account_linking / policy_enforcement
    // / unknown → stored, never counted, never a lead, never unread, never SLA.
    return INERT;
  }

  if (CONTENT_EVENTS.has(t)) {
    // An echo is our own page's message reflected back: a real outgoing bubble,
    // but obviously not an incoming patient message.
    const incoming = event.direction === "incoming" && !event.isEcho;
    return {
      createsMessageRow: true,
      mutatesExistingMessage: false,
      isConversationEvent: false,
      countsAsIncomingMessage: incoming,
      affectsUnread: incoming,
      affectsSla: incoming,
      mayCreateLead: incoming,
      isTimelineEvent: false,
    };
  }

  // Genuinely unrecognised event type: store it, count nothing, crash never.
  return INERT;
}

/**
 * Which direction a status event describes. Delivery/read receipts report on
 * OUR outgoing messages even though the webhook envelope may label the event
 * as arriving from the customer.
 */
export function statusTargetDirection(event: MetaEvent): "incoming" | "outgoing" | null {
  if (!isMessageEvent(event)) return null;
  if (event.eventType !== "delivery" && event.eventType !== "read") return null;
  return event.statusForDirection ?? "outgoing";
}
