/**
 * The ingestion rules. Everything the spec cares about is decided here.
 *
 * Invariants this module enforces, in order of how much damage violating them
 * would do:
 *
 *  1. A webhook retry never inserts a second row. Every branch dedupes on a
 *     stable, platform-derived `eventKey` before writing.
 *  2. Status events (delivery, read, reaction, referral, unknown, optin,
 *     account_linking, policy_enforcement) never create a lead, never count as
 *     a message, never mark a conversation unread, never start an SLA timer.
 *  3. A lead is created only from genuine incoming content, and only when the
 *     actor's identity is `strong` or `medium`. A display name is not identity.
 *  4. Nothing is ever dropped. An event we cannot attach to a lead, a message,
 *     or a comment is still stored with its `raw_payload` intact.
 *  5. Deletion is a state change, never a row removal.
 */

import { classify } from "./classify";
import { canIdentifyLead, displayName } from "./identity";
import { eventKey as computeEventKey } from "./keys";
import type { MetaStore, LeadRef, ConversationRef } from "./store";
import {
  isMessageEvent,
  type MetaCommentEvent,
  type MetaEvent,
  type MetaMessageEvent,
} from "./types";

export interface IngestOutcome {
  eventKey: string;
  recordType: string;
  eventType: string;
  created: boolean;
  updated: boolean;
  skipped: boolean;
  skipReason: string | null;
  leadId: string | null;
  messageId: string | null;
  commentId: string | null;
}

function outcome(e: MetaEvent, key: string, patch: Partial<IngestOutcome> = {}): IngestOutcome {
  return {
    eventKey: key,
    recordType: e.recordType,
    eventType: isMessageEvent(e) ? e.eventType : e.eventType,
    created: false,
    updated: false,
    skipped: false,
    skipReason: null,
    leadId: null,
    messageId: null,
    commentId: null,
    ...patch,
  };
}

/* ── lead + conversation resolution ─────────────────────────────────────── */

/**
 * Find the lead this event belongs to, creating one only when the event is
 * allowed to and the identity is trustworthy enough.
 *
 * The lookup order matters: a platform-scoped user id is the strongest anchor,
 * but a conversation key still correctly attaches a weakly-identified event to
 * a conversation we already know about. That is how a `facebook_name:`-only
 * reaction still lands on the right lead without ever being able to CREATE one.
 */
async function resolveLead(
  store: MetaStore,
  event: MetaEvent,
  mayCreate: boolean,
): Promise<{ lead: LeadRef | null; created: boolean }> {
  const { identity, platform, conversationKey } = event;
  const identifiable = canIdentifyLead(identity);

  if (identifiable && identity.platformUserId) {
    const found = await store.findLeadByPlatformUser(platform, identity.platformUserId);
    if (found) return { lead: found, created: false };
  }

  if (conversationKey) {
    const found = await store.findLeadByConversationKey(conversationKey);
    if (found) return { lead: found, created: false };
  }

  // Creating a lead is the one irreversible act here. Both gates must pass.
  if (!mayCreate || !identifiable || !identity.platformUserId) {
    return { lead: null, created: false };
  }

  const referral = isMessageEvent(event) ? event.referral : null;
  const lead = await store.createLead({
    platform,
    platformUserId: identity.platformUserId,
    name: displayName(identity),
    conversationKey,
    chatLink: isMessageEvent(event) ? event.chatLink : null,
    pageId: event.pageId,
    instagramAccountId: event.instagramAccountId,
    conversationLink: isMessageEvent(event) ? event.conversationLink : null,
    fallbackInboxLink: event.fallbackInboxLink,
    pageInboxLink: isMessageEvent(event) ? event.pageInboxLink : null,
    firstContactAt: event.timestamp,
    campaign: referral?.campaign ?? (isMessageEvent(event) ? null : event.campaign),
    adName: referral?.adName ?? (isMessageEvent(event) ? null : event.adName),
  });
  return { lead, created: true };
}

async function resolveConversation(
  store: MetaStore,
  event: MetaMessageEvent,
  leadId: string | null,
): Promise<ConversationRef | null> {
  if (!event.conversationKey && !event.identity.platformUserId) return null;
  return store.upsertConversation({
    leadId,
    platform: event.platform,
    source: event.source,
    conversationKey: event.conversationKey,
    platformUserId: event.identity.platformUserId,
    identityConfidence: event.identity.confidence,
    pageId: event.pageId,
    instagramAccountId: event.instagramAccountId,
    customerPsid: event.identity.psid,
    customerInstagramId: event.identity.instagramId,
    chatLink: event.chatLink,
    conversationLink: event.conversationLink,
    fallbackInboxLink: event.fallbackInboxLink,
    pageInboxLink: event.pageInboxLink,
    rawPayload: event.rawPayload,
  });
}

/* ── attribution ────────────────────────────────────────────────────────── */

async function applyReferralAttribution(
  store: MetaStore,
  event: MetaMessageEvent,
  leadId: string,
): Promise<void> {
  const r = event.referral;
  if (!r) return;

  const { firstTouch } = await store.applyAttribution({
    leadId,
    source: r.source ?? event.source,
    campaign: r.campaign,
    adId: r.adId,
    adName: r.adName,
    referralSource: r.source,
    referralType: r.type,
    referralCode: r.code,
    referral: r.raw,
    touchedAt: event.timestamp,
  });

  // A referral is a system event on the lead's story, not a message from them.
  const label = r.adName ?? r.campaign ?? r.source ?? "an ad";
  await store.addTimelineEvent({
    leadId,
    eventType: firstTouch ? "attribution_first_touch" : "attribution_latest_touch",
    title: firstTouch
      ? `Lead entered from ${event.platform === "instagram" ? "Instagram" : "Facebook"} — ${label}`
      : `Returned via ${label}`,
    body: r.code ? `Referral code: ${r.code}` : null,
    metadata: { adId: r.adId, campaign: r.campaign, source: r.source, type: r.type },
    eventAt: event.timestamp,
  });

  await store.addAuditLog({
    action: "lead_attribution_updated",
    entityType: "lead",
    entityId: leadId,
    oldValues: null,
    newValues: { campaign: r.campaign, adId: r.adId, adName: r.adName, source: r.source, firstTouch },
    metadata: { eventType: event.eventType },
    source: "meta_webhook",
  });
}

/* ── message-record handlers ────────────────────────────────────────────── */

async function handleContentMessage(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
): Promise<IngestOutcome> {
  // Dedupe FIRST: a retry must not even resolve or create a lead.
  const existing = event.platformMessageId
    ? await store.findMessageByPlatformId(event.platform, event.platformMessageId)
    : await store.findMessageByEventKey(key);
  if (existing) {
    return outcome(event, key, {
      skipped: true,
      skipReason: "duplicate",
      leadId: existing.leadId,
      messageId: existing.id,
    });
  }

  const sem = classify(event);
  const { lead, created: leadCreated } = await resolveLead(store, event, sem.mayCreateLead);
  const conversation = await resolveConversation(store, event, lead?.id ?? null);

  const outgoing = event.direction === "outgoing";
  const { message, created } = await store.insertMessage({
    leadId: lead?.id ?? null,
    conversationId: conversation?.id ?? null,
    eventKey: key,
    platform: event.platform,
    source: event.source,
    recordType: "message",
    eventType: event.eventType,
    eventAction: event.eventAction,
    direction: event.direction,
    isConversationContent: true,
    text: event.text ?? event.postbackTitle,
    messageType: event.messageType,
    platformMessageId: event.platformMessageId,
    messageAt: event.timestamp,
    identityConfidence: event.identity.confidence,
    platformUserId: event.identity.platformUserId,
    senderId: event.senderId,
    recipientId: event.recipientId,
    senderName: event.identity.name,
    senderUsername: event.identity.username,
    senderPhone: event.identity.phone,
    sentByType: event.sentByType ?? (outgoing ? "page" : "user"),
    sentByName: event.sentByName ?? displayName(event.identity),
    isEcho: event.isEcho,
    isDeleted: event.isDeleted,
    isUnsupported: event.isUnsupported,
    pageId: event.pageId,
    recipientPageId: event.recipientPageId,
    instagramAccountId: event.instagramAccountId,
    customerPsid: event.identity.psid,
    customerInstagramId: event.identity.instagramId,
    conversationKey: event.conversationKey,
    chatLink: event.chatLink,
    conversationLink: event.conversationLink,
    fallbackInboxLink: event.fallbackInboxLink,
    pageInboxLink: event.pageInboxLink,
    attachmentCount: event.attachments.length,
    // Legacy single-URL column, kept in sync so pre-0005 read paths still work.
    attachmentUrl: event.attachments[0]?.url ?? null,
    quickReplyPayload: event.quickReplyPayload,
    quickReplyText: event.quickReplyText,
    postbackPayload: event.postbackPayload,
    postbackTitle: event.postbackTitle,
    replyToMessageId: event.replyToMessageId,
    replyTo: event.replyTo,
    // Our own outgoing messages start at "sent"; receipts advance them.
    deliveryStatus: outgoing ? "sent" : null,
    facebookAppId: event.facebookAppId,
    campaign: event.referral?.campaign ?? null,
    adId: event.referral?.adId ?? null,
    adName: event.referral?.adName ?? null,
    referralSource: event.referral?.source ?? null,
    referralType: event.referral?.type ?? null,
    referralCode: event.referral?.code ?? null,
    referral: event.referral?.raw ?? null,
    messageMetadata: event.messageMetadata,
    webhookObject: event.webhookObject,
    webhookEventKeys: event.webhookEventKeys,
    service: event.service,
    doctor: event.doctor,
    branch: event.branch,
    rawPayload: event.rawPayload,
  });

  if (!created) {
    return outcome(event, key, {
      skipped: true,
      skipReason: "duplicate",
      leadId: message.leadId,
      messageId: message.id,
    });
  }

  // Attachments are one-to-many and order-sensitive. Text and attachments
  // coexist: a captioned photo is ONE message with a body and an attachment.
  if (event.attachments.length > 0) {
    await store.setAttachments(message.id, event.attachments);
  }

  // A referral riding along with a message updates attribution but does not
  // become its own bubble.
  if (event.referral && lead) {
    await applyReferralAttribution(store, event, lead.id);
  }

  if (conversation) {
    await store.touchConversation(conversation.id, {
      lastMessageAt: event.timestamp,
      ...(outgoing ? { lastOutgoingAt: event.timestamp } : { lastIncomingAt: event.timestamp }),
    });
  }

  if (lead) {
    if (sem.affectsUnread) await store.markLeadIncoming(lead.id, event.timestamp, message.id);
    else if (outgoing) await store.markLeadOutgoing(lead.id, event.timestamp);
  }

  return outcome(event, key, {
    created: true,
    leadId: lead?.id ?? null,
    messageId: message.id,
    skipReason: leadCreated ? "lead_created" : null,
  });
}

async function handleMessageEdit(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
): Promise<IngestOutcome> {
  const targetId = event.targetMessageId ?? event.platformMessageId;
  const target = targetId ? await store.findMessageByPlatformId(event.platform, targetId) : null;

  if (!target) {
    // The edit arrived before (or without) its original. Store it rather than
    // drop it; it must not become a second bubble.
    const stored = await storeConversationEvent(store, event, key, null, null);
    return outcome(event, key, {
      created: stored,
      skipped: !stored,
      skipReason: stored ? "edit_target_not_found" : "duplicate",
    });
  }

  const newText = event.editedText ?? event.text;
  const revision = event.editCount > 0 ? event.editCount : target.editCount + 1;

  const recorded = await store.recordMessageEdit({
    messageId: target.id,
    editCount: revision,
    previousText: target.text,
    newText,
    editedAt: event.timestamp,
    rawPayload: event.rawPayload,
  });
  if (!recorded) {
    return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: target.leadId, messageId: target.id });
  }

  await store.updateMessageText(target.id, newText ?? "", revision, event.timestamp);
  await store.addAuditLog({
    action: "message_edited",
    entityType: "crm_message",
    entityId: target.id,
    oldValues: { message_text: target.text },
    newValues: { message_text: newText, edit_count: revision },
    metadata: { platform: event.platform, platformMessageId: targetId },
    source: "meta_webhook",
  });

  // Deliberately no unread / SLA change: an edit is not a new message.
  return outcome(event, key, { updated: true, leadId: target.leadId, messageId: target.id });
}

async function handleReaction(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
): Promise<IngestOutcome> {
  if (!event.targetMessageId) {
    const stored = await storeConversationEvent(store, event, key, null, null);
    return outcome(event, key, { created: stored, skipped: !stored, skipReason: stored ? "reaction_without_target" : "duplicate" });
  }

  const target = await store.findMessageByPlatformId(event.platform, event.targetMessageId);
  const action = (event.reactionAction ?? "react").toLowerCase();
  const isUnreact = action === "unreact" || action === "remove";

  const recorded = await store.recordReaction({
    messageId: target?.id ?? null,
    targetMessageId: event.targetMessageId,
    platform: event.platform,
    actorPlatformUserId: event.identity.platformUserId,
    reactionAction: isUnreact ? "unreact" : "react",
    reactionType: event.reactionType,
    reactionEmoji: event.reactionEmoji,
    reactedAt: event.timestamp,
    // An `unreact` row is history, not a live reaction.
    isActive: !isUnreact,
    eventKey: key,
    rawPayload: event.rawPayload,
  });
  if (!recorded) {
    return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: target?.leadId ?? null });
  }

  if (isUnreact) {
    await store.deactivateReactions(event.platform, event.targetMessageId, event.identity.platformUserId);
  }

  return outcome(event, key, { created: true, leadId: target?.leadId ?? null, messageId: target?.id ?? null });
}

async function handleReceipt(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
): Promise<IngestOutcome> {
  const isRead = event.eventType === "read";
  const state = isRead ? "seen" : "delivered";

  const { lead } = await resolveLead(store, event, false);
  const conversation = await resolveConversation(store, event, lead?.id ?? null);

  const stored = await storeConversationEvent(store, event, key, lead?.id ?? null, conversation?.id ?? null);
  if (!stored) {
    return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: lead?.id ?? null });
  }

  let touched = 0;
  const explicitIds = event.deliveredMessageIds.length
    ? event.deliveredMessageIds
    : event.targetMessageId
      ? [event.targetMessageId]
      : [];

  if (explicitIds.length > 0) {
    // Exact ids are authoritative — no guessing from timestamps.
    touched = isRead
      ? await store.markMessagesSeen(event.platform, explicitIds, event.timestamp)
      : await store.markMessagesDelivered(event.platform, explicitIds, event.timestamp);
  } else if (event.statusWatermark) {
    // Watermark semantics: everything OUTGOING sent at or before the watermark
    // has reached this state. Messages sent after it must stay untouched, or a
    // reply the patient has not yet seen would falsely show "Seen".
    touched = await store.markOutgoingBeforeWatermark(
      conversation?.id ?? null,
      lead?.id ?? null,
      event.platform,
      event.statusWatermark,
      state,
    );
  }

  if (conversation) {
    await store.touchConversation(conversation.id, isRead ? { lastSeenAt: event.timestamp } : { lastDeliveredAt: event.timestamp });
  }

  // No unread change, no SLA change, no lead creation, no audit noise.
  return outcome(event, key, { created: true, updated: touched > 0, leadId: lead?.id ?? null });
}

async function handleReferral(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
): Promise<IngestOutcome> {
  const sem = classify(event);
  const { lead } = await resolveLead(store, event, sem.mayCreateLead);
  const conversation = await resolveConversation(store, event, lead?.id ?? null);

  const stored = await storeConversationEvent(store, event, key, lead?.id ?? null, conversation?.id ?? null);
  if (!stored) {
    return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: lead?.id ?? null });
  }

  if (lead) await applyReferralAttribution(store, event, lead.id);

  return outcome(event, key, {
    created: true,
    leadId: lead?.id ?? null,
    skipReason: lead ? null : "no_identity_for_lead",
  });
}

/** delivery/read/referral/reaction/unknown/optin/account_linking/policy_enforcement. */
async function storeConversationEvent(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
  leadId: string | null,
  conversationId: string | null,
): Promise<boolean> {
  return store.insertConversationEvent({
    leadId,
    conversationId,
    eventKey: key,
    platform: event.platform,
    source: event.source,
    recordType: "message",
    eventType: event.eventType,
    eventAction: event.eventAction,
    pageId: event.pageId,
    instagramAccountId: event.instagramAccountId,
    platformUserId: event.identity.platformUserId,
    identityConfidence: event.identity.confidence,
    conversationKey: event.conversationKey,
    direction: event.direction,
    statusForDirection: event.statusForDirection,
    targetMessageId: event.targetMessageId,
    deliveredMessageIds: event.deliveredMessageIds,
    statusWatermark: event.statusWatermark,
    referralSource: event.referral?.source ?? null,
    referralType: event.referral?.type ?? null,
    referralCode: event.referral?.code ?? null,
    campaign: event.referral?.campaign ?? null,
    adId: event.referral?.adId ?? null,
    adName: event.referral?.adName ?? null,
    referral: event.referral?.raw ?? null,
    webhookObject: event.webhookObject,
    webhookEventKeys: event.webhookEventKeys,
    eventAt: event.timestamp,
    rawPayload: event.rawPayload,
  });
}

async function handleUnknown(
  store: MetaStore,
  event: MetaMessageEvent,
  key: string,
): Promise<IngestOutcome> {
  // Attach to an existing lead when we can, but never create one, and never
  // let an unrecognised shape fail the request.
  const { lead } = await resolveLead(store, event, false);
  const stored = await storeConversationEvent(store, event, key, lead?.id ?? null, null);
  return outcome(event, key, {
    created: stored,
    skipped: !stored,
    skipReason: stored ? null : "duplicate",
    leadId: lead?.id ?? null,
  });
}

/* ── comment-record handler ─────────────────────────────────────────────── */

async function handleComment(
  store: MetaStore,
  event: MetaCommentEvent,
  key: string,
): Promise<IngestOutcome> {
  const sem = classify(event);
  const existing = event.commentId
    ? await store.findCommentByPlatformId(event.platform, event.commentId)
    : await store.findCommentByEventKey(key);

  /* ── update ───────────────────────────────────────────────────────────── */
  if (existing && event.eventAction === "updated") {
    if ((existing.text ?? "") === (event.text ?? "")) {
      return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: existing.leadId, commentId: existing.id });
    }
    const revision = existing.editCount + 1;
    const recorded = await store.recordCommentEdit({
      commentId: existing.id,
      revision,
      previousText: existing.text,
      newText: event.text,
      changeType: "updated",
      editedAt: event.timestamp,
      rawPayload: event.rawPayload,
    });
    if (!recorded) {
      return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: existing.leadId, commentId: existing.id });
    }
    await store.updateComment(existing.id, { text: event.text, isEdited: true, editCount: revision });
    await store.addAuditLog({
      action: "comment_edited",
      entityType: "crm_comment",
      entityId: existing.id,
      oldValues: { comment_text: existing.text },
      newValues: { comment_text: event.text },
      metadata: { platform: event.platform, commentId: event.commentId },
      source: "meta_webhook",
    });
    return outcome(event, key, { updated: true, leadId: existing.leadId, commentId: existing.id });
  }

  /* ── delete ───────────────────────────────────────────────────────────── */
  if (existing && event.eventAction === "deleted") {
    if (existing.isDeleted) {
      return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: existing.leadId, commentId: existing.id });
    }
    await store.recordCommentEdit({
      commentId: existing.id,
      revision: existing.editCount + 1,
      previousText: existing.text,
      newText: null,
      changeType: "deleted",
      editedAt: event.timestamp,
      rawPayload: event.rawPayload,
    });
    // The row survives: the Comments tab shows "Comment deleted" and the audit
    // trail keeps the original text.
    await store.updateComment(existing.id, {
      isDeleted: true,
      deletedAt: event.timestamp,
      editCount: existing.editCount + 1,
    });
    await store.addAuditLog({
      action: "comment_deleted",
      entityType: "crm_comment",
      entityId: existing.id,
      oldValues: { comment_text: existing.text, is_deleted: false },
      newValues: { is_deleted: true },
      metadata: { platform: event.platform, commentId: event.commentId },
      source: "meta_webhook",
    });
    return outcome(event, key, { updated: true, leadId: existing.leadId, commentId: existing.id });
  }

  /* ── create (or an update/delete whose original we never saw) ──────────── */
  if (existing) {
    return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: existing.leadId, commentId: existing.id });
  }

  const { lead } = await resolveLead(store, event, sem.mayCreateLead);
  const { comment, created } = await store.insertComment({
    leadId: lead?.id ?? null,
    eventKey: key,
    platform: event.platform,
    source: event.source,
    recordType: "comment",
    eventType: event.eventType,
    eventAction: event.eventAction,
    commentId: event.commentId,
    parentCommentId: event.parentCommentId,
    rawParentId: event.rawParentId,
    threadRootCommentId: event.threadRootCommentId,
    threadRole: event.threadRole,
    isReply: event.isReply,
    postId: event.postId,
    mediaId: event.mediaId,
    text: event.text,
    commentAt: event.timestamp,
    direction: event.direction,
    isPageOrBusinessReply: event.isPageOrBusinessReply,
    identityConfidence: event.identity.confidence,
    platformUserId: event.identity.platformUserId,
    commenterId: event.commenterId,
    commenterUsername: event.commenterUsername,
    commenterName: event.commenterName,
    pageId: event.pageId,
    instagramAccountId: event.instagramAccountId,
    conversationKey: event.conversationKey,
    commentThreadKey: event.commentThreadKey,
    messageType: event.messageType,
    commentType: event.commentType,
    facebookVerb: event.facebookVerb,
    eventSourceField: event.eventSourceField,
    isEdited: event.isEdited,
    isDeleted: event.isDeleted,
    commentLink: event.commentLink,
    fallbackInboxLink: event.fallbackInboxLink,
    mediaPermalink: event.mediaPermalink,
    mediaCaption: event.mediaCaption,
    mediaType: event.mediaType,
    mediaProductType: event.mediaProductType,
    attachmentCount: event.attachments.length,
    attachmentUrl: event.attachments[0]?.url ?? null,
    campaign: event.campaign,
    adId: event.adId,
    adName: event.adName,
    webhookObject: event.webhookObject,
    webhookChangeField: event.webhookChangeField,
    rawPayload: event.rawPayload,
  });

  if (!created) {
    return outcome(event, key, { skipped: true, skipReason: "duplicate", leadId: comment.leadId, commentId: comment.id });
  }

  if (event.attachments.length > 0) {
    await store.setCommentAttachments(comment.id, event.attachments);
  }

  if (lead) {
    if (sem.affectsUnread) await store.markLeadIncoming(lead.id, event.timestamp, null);
    else if (event.isPageOrBusinessReply) await store.markLeadOutgoing(lead.id, event.timestamp);
  }

  return outcome(event, key, { created: true, leadId: lead?.id ?? null, commentId: comment.id });
}

/* ── entry point ────────────────────────────────────────────────────────── */

/** Ingest one canonical event. Never throws for a merely-unrecognised event. */
export async function ingestEvent(store: MetaStore, event: MetaEvent): Promise<IngestOutcome> {
  const key = computeEventKey(event);

  if (!isMessageEvent(event)) return handleComment(store, event, key);

  switch (event.eventType) {
    case "message":
    case "postback":
      return handleContentMessage(store, event, key);
    case "message_edit":
      return handleMessageEdit(store, event, key);
    case "reaction":
      return handleReaction(store, event, key);
    case "delivery":
    case "read":
      return handleReceipt(store, event, key);
    case "referral":
      return handleReferral(store, event, key);
    default:
      return handleUnknown(store, event, key);
  }
}

/** Ingest a batch, isolating failures so one bad event cannot sink the rest. */
export async function ingestEvents(
  store: MetaStore,
  events: MetaEvent[],
): Promise<{ outcomes: IngestOutcome[]; errors: { eventKey: string; error: string }[] }> {
  const outcomes: IngestOutcome[] = [];
  const errors: { eventKey: string; error: string }[] = [];

  for (const event of events) {
    const key = computeEventKey(event);
    try {
      const result = await ingestEvent(store, event);
      outcomes.push(result);
      await store.log({
        source: event.source,
        platform: event.platform,
        recordType: event.recordType,
        eventType: result.eventType,
        eventAction: isMessageEvent(event) ? event.eventAction : event.eventAction,
        eventKey: result.eventKey,
        pageId: event.pageId,
        platformUserId: event.identity.platformUserId,
        conversationKey: event.conversationKey,
        commentId: isMessageEvent(event) ? null : event.commentId,
        commentThreadKey: isMessageEvent(event) ? null : event.commentThreadKey,
        platformMessageId: isMessageEvent(event) ? event.platformMessageId : null,
        messageId: result.messageId,
        leadId: result.leadId,
        direction: event.direction,
        messageText: event.text,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        skipReason: result.skipReason,
        matchReason: result.leadId ? "platform_user_id" : null,
        errors: null,
        rawPayload: event.rawPayload,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ eventKey: key, error: message });
      // A failed event is logged, not lost, and does not abort the batch.
      await store
        .log({
          source: event.source,
          platform: event.platform,
          recordType: event.recordType,
          eventType: isMessageEvent(event) ? event.eventType : event.eventType,
          eventAction: event.eventAction,
          eventKey: key,
          pageId: event.pageId,
          platformUserId: event.identity.platformUserId,
          conversationKey: event.conversationKey,
          commentId: isMessageEvent(event) ? null : event.commentId,
          commentThreadKey: isMessageEvent(event) ? null : event.commentThreadKey,
          platformMessageId: isMessageEvent(event) ? event.platformMessageId : null,
          messageId: null,
          leadId: null,
          direction: event.direction,
          messageText: event.text,
          created: false,
          updated: false,
          skipped: true,
          skipReason: "error",
          matchReason: null,
          errors: { message },
          rawPayload: event.rawPayload,
        })
        .catch(() => {
          /* logging must never mask the original failure */
        });
    }
  }

  return { outcomes, errors };
}
