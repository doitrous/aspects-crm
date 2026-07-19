/**
 * The 44 required ingestion scenarios, run end-to-end:
 *
 *     n8n / Meta payload → toEvents() → ingestEvents() → MemoryStore
 *
 * Nothing is mocked between those stages, so a passing test here means the
 * normalizer, the classifier, the idempotency keys and the persistence rules
 * agree with each other — not merely with a stub written to agree with them.
 *
 * The invariants under test, restated:
 *
 *   • Status events (delivery, read, reaction, referral, unknown) never create a
 *     lead, never become a chat bubble, never mark a lead unread, never start
 *     the reply-SLA clock, and never inflate "Total Messages".
 *   • A webhook retry inserts nothing.
 *   • A weak identity (a display name) never creates or merges a lead.
 *   • Nothing is ever dropped — an event we cannot attach is still stored.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { toEvents } from "./normalize";
import { ingestEvents } from "./persist";
import { MemoryStore, REPLY_SLA_MINUTES, resetIds } from "./store.memory";

/* ── harness ────────────────────────────────────────────────────────────── */

const T0 = "2026-07-01T10:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * 60_000).toISOString();
const ms = (minutes: number) => Date.parse(T0) + minutes * 60_000;

function newStore(): MemoryStore {
  resetIds();
  return new MemoryStore();
}

/** Ingest a payload and fail loudly if any event threw. */
async function ingest(store: MemoryStore, body: unknown) {
  const result = await ingestEvents(store, toEvents(body));
  assert.deepEqual(result.errors, [], "ingestion must not throw");
  return result.outcomes;
}

type Rec = Record<string, unknown>;

/* ── payload builders ───────────────────────────────────────────────────── */

const fbIncoming = (over: Rec = {}): Rec => ({
  record_type: "message",
  event_type: "message",
  platform: "facebook",
  page_id: "PAGE1",
  platform_user_id: "PSID_1",
  customer_psid: "PSID_1",
  sender_id: "PSID_1",
  recipient_id: "PAGE1",
  identity_confidence: "strong",
  sender_name: "Mona Ali",
  conversation_key: "fb:PAGE1:PSID_1",
  direction: "incoming",
  message_timestamp: T0,
  platform_message_id: "mid.in1",
  message_text: "Hello, how much is a consultation?",
  ...over,
});

const fbOutgoing = (over: Rec = {}): Rec => ({
  record_type: "message",
  event_type: "message",
  platform: "facebook",
  page_id: "PAGE1",
  sender_id: "PAGE1",
  recipient_id: "PSID_1",
  is_echo: true,
  sent_by_type: "page",
  sent_by_name: "Clinic",
  conversation_key: "fb:PAGE1:PSID_1",
  message_timestamp: at(5),
  platform_message_id: "mid.out1",
  message_text: "Hi Mona! Consultation is 300 EGP.",
  ...over,
});

const igIncoming = (over: Rec = {}): Rec => ({
  record_type: "message",
  event_type: "message",
  platform: "instagram",
  page_id: "PAGE1",
  instagram_account_id: "IGACC1",
  platform_user_id: "IGSID_1",
  customer_instagram_id: "IGSID_1",
  sender_id: "IGSID_1",
  recipient_id: "IGACC1",
  identity_confidence: "strong",
  sender_username: "mona.skin",
  conversation_key: "ig:IGACC1:IGSID_1",
  direction: "incoming",
  message_timestamp: T0,
  platform_message_id: "mid.ig.in1",
  message_text: "Do you do laser?",
  ...over,
});

const igOutgoing = (over: Rec = {}): Rec => ({
  record_type: "message",
  event_type: "message",
  platform: "instagram",
  page_id: "PAGE1",
  instagram_account_id: "IGACC1",
  sender_id: "IGACC1",
  recipient_id: "IGSID_1",
  is_echo: true,
  sent_by_type: "page",
  sent_by_name: "Clinic",
  conversation_key: "ig:IGACC1:IGSID_1",
  message_timestamp: at(5),
  platform_message_id: "mid.ig.out1",
  message_text: "Yes we do!",
  ...over,
});

const fbComment = (over: Rec = {}): Rec => ({
  record_type: "comment",
  event_type: "comment",
  platform: "facebook",
  page_id: "PAGE1",
  facebook_verb: "add",
  comment_id: "fbc_1",
  post_id: "POST1",
  commenter_id: "CUSER_1",
  commenter_name: "Sara Nabil",
  platform_user_id: "CUSER_1",
  identity_confidence: "strong",
  comment_text: "How much?",
  comment_timestamp: T0,
  comment_link: "https://facebook.com/POST1?comment_id=fbc_1",
  ...over,
});

const igComment = (over: Rec = {}): Rec => ({
  record_type: "comment",
  event_type: "comment",
  platform: "instagram",
  instagram_account_id: "IGACC1",
  event_action: "created",
  comment_id: "igc_1",
  media_id: "MEDIA1",
  commenter_id: "IGCUSER_1",
  commenter_username: "sara.n",
  platform_user_id: "IGCUSER_1",
  identity_confidence: "strong",
  comment_text: "Price please",
  comment_timestamp: T0,
  ...over,
});

/** Attachments for a message the customer sent, in platform order. */
const image = (i: number) => ({ index: i, type: "image", url: `https://cdn.meta/img${i}.jpg` });

/* ══ FACEBOOK: 1–21 ═════════════════════════════════════════════════════ */

test("01 — FB incoming text creates the lead, one bubble, unread + SLA clock", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());

  assert.equal(s.leads.length, 1);
  assert.equal(s.contentMessages().length, 1);

  const lead = s.leads[0];
  assert.equal(lead.name, "Mona Ali");
  assert.equal(lead.hasUnread, true);
  assert.equal(lead.unreadMessageCount, 1);
  assert.equal(lead.unreadSince, T0);
  assert.equal(lead.replyOverdueAt, at(REPLY_SLA_MINUTES));
  const sourceLink = new URL(lead.conversationLink!);
  assert.equal(sourceLink.pathname, "/latest/inbox/all");
  assert.equal(sourceLink.searchParams.get("selected_item_id"), "PSID_1");
  assert.equal(sourceLink.searchParams.get("thread_type"), "FB_MESSAGE");

  const m = s.contentMessages()[0];
  assert.equal(m.direction, "incoming");
  assert.equal(m.leadId, lead.id);
  assert.equal(m.deliveryStatus, null);
  assert.ok(m.rawPayload, "raw payload is preserved");
});

test("02 — FB outgoing echo answers the lead: unread cleared, status 'sent'", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing());

  assert.equal(s.leads.length, 1, "an echo never creates a lead");
  assert.equal(s.contentMessages().length, 2);

  const lead = s.leads[0];
  assert.equal(lead.hasUnread, false);
  assert.equal(lead.unreadMessageCount, 0);
  assert.equal(lead.replyOverdueAt, null);
  assert.equal(lead.lastHandledAt, at(5));

  const out = s.messages.find((m) => m.platformMessageId === "mid.out1")!;
  assert.equal(out.direction, "outgoing");
  assert.equal(out.deliveryStatus, "sent");
});

test("03 — FB text + image is ONE message; the caption survives", async () => {
  const s = newStore();
  await ingest(s, fbIncoming({ message_text: "Is this normal?", attachments: [image(0)] }));

  assert.equal(s.contentMessages().length, 1);
  const m = s.contentMessages()[0];
  assert.equal(m.text, "Is this normal?");
  assert.equal(m.attachmentCount, 1);
  assert.equal(s.attachments.filter((a) => a.messageId === m.id).length, 1);
});

test("04 — FB multiple images: every attachment kept, order preserved", async () => {
  const s = newStore();
  await ingest(s, fbIncoming({ message_text: null, attachments: [image(0), image(1), image(2)] }));

  const m = s.contentMessages()[0];
  const atts = s.attachments.filter((a) => a.messageId === m.id);
  assert.equal(atts.length, 3, "never store only attachments[0]");
  assert.deepEqual(
    atts.map((a) => a.index),
    [0, 1, 2],
  );
  assert.deepEqual(
    atts.map((a) => a.url),
    ["https://cdn.meta/img0.jpg", "https://cdn.meta/img1.jpg", "https://cdn.meta/img2.jpg"],
  );
});

test("05 — FB voice note stores an audio attachment", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({
      message_text: null,
      message_type: "audio",
      attachments: [{ index: 0, type: "audio", url: "https://cdn.meta/voice.mp4" }],
    }),
  );

  const m = s.contentMessages()[0];
  const att = s.attachments.find((a) => a.messageId === m.id)!;
  assert.equal(att.type, "audio");
  assert.equal(m.messageType, "audio");
});

test("06 — FB quick reply is ONE message carrying its payload, not two", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({ message_text: "Book now", quick_reply_payload: "BOOK_NOW", quick_reply_text: "Book now" }),
  );

  assert.equal(s.contentMessages().length, 1, "a quick reply is not two messages");
  const m = s.contentMessages()[0];
  assert.equal(m.text, "Book now");
  assert.equal(m.quickReplyPayload, "BOOK_NOW");
  assert.equal(m.quickReplyText, "Book now");
});

test("07 — FB postback renders as one message titled by the button, no fake text twin", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({
      event_type: "postback",
      message_text: null,
      platform_message_id: "mid.pb1",
      postback_payload: "GET_STARTED",
      postback_title: "Get Started",
    }),
  );

  assert.equal(s.contentMessages().length, 1, "no duplicate text message for a postback");
  const m = s.contentMessages()[0];
  assert.equal(m.postbackPayload, "GET_STARTED");
  assert.equal(m.postbackTitle, "Get Started");
  assert.equal(m.text, "Get Started", "the button title IS the content");
});

test("08 — FB standalone referral: timeline card + attribution, never a bubble", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({
      event_type: "referral",
      message_text: null,
      platform_message_id: null,
      referral_source: "ADS",
      referral_type: "OPEN_THREAD",
      referral_code: "ref123",
      ad_id: "AD1",
      ad_name: "Botox July",
      campaign: "CAMP_JULY",
    }),
  );

  assert.equal(s.contentMessages().length, 0, "a referral is not a chat bubble");
  assert.equal(s.conversationEvents.length, 1);
  assert.equal(s.leads.length, 1, "a referral with strong identity may create a lead");

  const lead = s.leads[0];
  assert.equal(lead.hasUnread, false, "a referral never marks the lead unread");
  assert.equal(lead.replyOverdueAt, null, "a referral never starts the SLA clock");

  const attr = s.attribution[0];
  assert.equal(attr.firstAdId, "AD1");
  assert.equal(attr.firstAdName, "Botox July");
  assert.equal(attr.firstCampaign, "CAMP_JULY");
  assert.equal(attr.firstReferralCode, "ref123");
  assert.equal(attr.touchCount, 1);

  assert.equal(s.timeline[0].eventType, "attribution_first_touch");
  assert.match(s.timeline[0].title, /Lead entered from Facebook/);
});

test("09 — FB referral attached to a message: one bubble, and first touch is never overwritten", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({
      message_text: "Saw your ad",
      referral_source: "ADS",
      ad_id: "AD1",
      ad_name: "Botox July",
      campaign: "CAMP_JULY",
    }),
  );
  assert.equal(s.contentMessages().length, 1, "the referral does not add a second row");

  // The same person returns weeks later through a different ad.
  await ingest(
    s,
    fbIncoming({
      event_type: "referral",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(60),
      referral_source: "ADS",
      ad_id: "AD2",
      ad_name: "Filler August",
      campaign: "CAMP_AUG",
    }),
  );

  const attr = s.attribution[0];
  assert.equal(attr.firstAdId, "AD1", "first touch is written once");
  assert.equal(attr.firstAdName, "Botox July");
  assert.equal(attr.latestAdId, "AD2");
  assert.equal(attr.latestAdName, "Filler August");
  assert.equal(attr.touchCount, 2);
  assert.equal(s.timeline[1].eventType, "attribution_latest_touch");
});

test("10 — FB reaction lands on the target message, creates no bubble and no unread", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing());
  const before = s.contentMessages().length;

  await ingest(
    s,
    fbIncoming({
      event_type: "reaction",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(6),
      target_message_id: "mid.out1",
      reaction_action: "react",
      reaction_type: "love",
      reaction_emoji: "❤",
    }),
  );

  assert.equal(s.contentMessages().length, before, "a reaction is not a message");
  const active = s.activeReactions("mid.out1");
  assert.equal(active.length, 1);
  assert.equal(active[0].reactionEmoji, "❤");
  assert.equal(active[0].messageId, s.messages.find((m) => m.platformMessageId === "mid.out1")!.id);

  const lead = s.leads[0];
  assert.equal(lead.hasUnread, false, "a reaction never marks the lead unread");
  assert.equal(lead.replyOverdueAt, null);
});

test("11 — FB unreaction removes the displayed reaction but keeps the audit history", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing());

  const reaction = (action: string, minute: number) =>
    fbIncoming({
      event_type: "reaction",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(minute),
      target_message_id: "mid.out1",
      reaction_action: action,
      reaction_type: "love",
      reaction_emoji: "❤",
    });

  await ingest(s, reaction("react", 6));
  await ingest(s, reaction("unreact", 7));

  assert.equal(s.activeReactions("mid.out1").length, 0, "no longer displayed");
  assert.equal(s.reactions.length, 2, "both events retained for auditing");
});

test("12 — FB delivery receipt with explicit mids advances only those messages", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing());
  await ingest(s, fbOutgoing({ platform_message_id: "mid.out2", message_timestamp: at(20) }));

  await ingest(
    s,
    fbIncoming({
      event_type: "delivery",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(21),
      status_for_direction: "outgoing",
      delivered_message_ids: ["mid.out1"],
    }),
  );

  assert.equal(s.messages.find((m) => m.platformMessageId === "mid.out1")!.deliveryStatus, "delivered");
  assert.equal(s.messages.find((m) => m.platformMessageId === "mid.out2")!.deliveryStatus, "sent");
  assert.equal(s.contentMessages().length, 3, "a receipt is not a message");
  assert.equal(s.leads[0].hasUnread, false, "a receipt never marks the lead unread");
});

test("13 — FB delivery with only a watermark never advances messages sent after it", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing()); // at(5)
  await ingest(s, fbOutgoing({ platform_message_id: "mid.out2", message_timestamp: at(20) }));

  await ingest(
    s,
    fbIncoming({
      event_type: "delivery",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(11),
      status_for_direction: "outgoing",
      status_watermark: ms(10),
    }),
  );

  assert.equal(s.messages.find((m) => m.platformMessageId === "mid.out1")!.deliveryStatus, "delivered");
  assert.equal(
    s.messages.find((m) => m.platformMessageId === "mid.out2")!.deliveryStatus,
    "sent",
    "a message sent after the watermark must not be marked delivered",
  );
});

test("14 — FB read receipt marks outgoing Seen, and never touches unread or SLA", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing());

  await ingest(
    s,
    fbIncoming({
      event_type: "read",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(9),
      status_for_direction: "outgoing",
      status_watermark: ms(8),
    }),
  );

  const out = s.messages.find((m) => m.platformMessageId === "mid.out1")!;
  assert.equal(out.deliveryStatus, "seen");
  assert.equal(out.seenAt, at(8));
  assert.equal(s.contentMessages().length, 2);
  assert.equal(s.leads[0].hasUnread, false);
  assert.equal(s.leads[0].unreadMessageCount, 0);
});

test("15 — FB message edit updates the original in place and keeps the old text", async () => {
  const s = newStore();
  await ingest(s, fbIncoming({ message_text: "Hw much?" }));
  const unreadBefore = s.leads[0].unreadMessageCount;

  await ingest(
    s,
    fbIncoming({
      event_type: "message_edit",
      platform_message_id: null,
      target_message_id: "mid.in1",
      edited_text: "How much?",
      edit_count: 1,
      message_timestamp: at(2),
    }),
  );

  assert.equal(s.contentMessages().length, 1, "an edit is not a new message");
  const m = s.contentMessages()[0];
  assert.equal(m.text, "How much?");
  assert.equal(m.editCount, 1);
  assert.equal(m.editedAt, at(2));

  assert.equal(s.messageEdits.length, 1);
  assert.equal(s.messageEdits[0].previousText, "Hw much?");
  assert.equal(s.messageEdits[0].newText, "How much?");
  assert.equal(s.leads[0].unreadMessageCount, unreadBefore, "an edit is not a new incoming message");
  assert.ok(s.audit.some((a) => a.action === "message_edited"));
});

test("16 — FB unknown messaging event is stored safely, creates nothing", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({
      event_type: "game_play",
      message_text: null,
      platform_message_id: null,
      conversation_key: null,
    }),
  );

  assert.equal(s.leads.length, 0, "an unknown event never creates a lead");
  assert.equal(s.contentMessages().length, 0);
  assert.equal(s.conversationEvents.length, 1, "stored, not dropped");
  assert.equal(s.conversationEvents[0].eventType, "unknown");
  assert.ok(s.conversationEvents[0].rawPayload);
});

test("17 — new FB comment creates the lead and marks it unread", async () => {
  const s = newStore();
  await ingest(s, fbComment());

  assert.equal(s.comments.length, 1);
  assert.equal(s.leads.length, 1);
  const c = s.comments[0];
  assert.equal(c.platform, "facebook");
  assert.equal(c.threadRole, "top_level");
  assert.equal(c.isReply, false);
  assert.equal(c.postId, "POST1");
  const sourceLink = new URL(c.commentLink!);
  assert.equal(sourceLink.pathname, "/latest/inbox/facebook");
  assert.equal(sourceLink.searchParams.get("selected_item_id"), "POST1");
  assert.equal(sourceLink.searchParams.get("thread_type"), "FB_PAGE_POST");
  assert.equal(s.leads[0].hasUnread, true, "a real customer comment is incoming content");
});

test("18 — FB comment reply is threaded under its parent", async () => {
  const s = newStore();
  await ingest(s, fbComment());
  await ingest(
    s,
    fbComment({
      comment_id: "fbc_2",
      parent_comment_id: "fbc_1",
      commenter_id: "CUSER_2",
      commenter_name: "Ahmed",
      platform_user_id: "CUSER_2",
      comment_text: "Same question",
      comment_timestamp: at(3),
    }),
  );

  const reply = s.comments.find((c) => c.commentId === "fbc_2")!;
  assert.equal(reply.isReply, true);
  assert.equal(reply.threadRole, "reply");
  assert.equal(reply.parentCommentId, "fbc_1");
  assert.equal(reply.threadRootCommentId, "fbc_1", "thread info is not flattened away");
});

test("19 — FB Page reply is a business reply and creates no lead", async () => {
  const s = newStore();
  await ingest(s, fbComment());
  await ingest(
    s,
    fbComment({
      comment_id: "fbc_3",
      parent_comment_id: "fbc_1",
      is_page_or_business_reply: true,
      commenter_id: "PAGE1",
      commenter_name: "Aspects Clinica",
      platform_user_id: "PAGE1",
      comment_text: "DM us please",
      comment_timestamp: at(4),
    }),
  );

  const reply = s.comments.find((c) => c.commentId === "fbc_3")!;
  assert.equal(reply.isPageOrBusinessReply, true);
  assert.equal(reply.threadRole, "business_reply");
  assert.equal(reply.direction, "outgoing");
  assert.equal(s.leads.length, 1, "our own reply is not a new lead");
});

test("20 — FB edited comment updates the row and preserves the previous text", async () => {
  const s = newStore();
  await ingest(s, fbComment({ comment_text: "How much" }));
  await ingest(s, fbComment({ facebook_verb: "edited", comment_text: "How much is Botox?", comment_timestamp: at(3) }));

  assert.equal(s.comments.length, 1, "an edit never inserts a second comment");
  const c = s.comments[0];
  assert.equal(c.text, "How much is Botox?");
  assert.equal(c.isEdited, true);
  assert.equal(c.editCount, 1);

  assert.equal(s.commentEdits[0].previousText, "How much");
  assert.equal(s.commentEdits[0].changeType, "updated");
  assert.ok(s.audit.some((a) => a.action === "comment_edited"));
});

test("21 — FB deleted comment is marked deleted; the row and its history survive", async () => {
  const s = newStore();
  await ingest(s, fbComment({ comment_text: "Original text" }));
  await ingest(s, fbComment({ facebook_verb: "remove", comment_timestamp: at(5) }));

  assert.equal(s.comments.length, 1, "deletion never inserts a duplicate row");
  const c = s.comments[0];
  assert.equal(c.isDeleted, true);
  assert.equal(c.deletedAt, at(5));

  const del = s.commentEdits.find((e) => e.changeType === "deleted")!;
  assert.equal(del.previousText, "Original text", "audit history keeps the evidence");
  assert.ok(s.audit.some((a) => a.action === "comment_deleted"));
});

/* ══ INSTAGRAM: 22–37 ═══════════════════════════════════════════════════ */

test("22 — IG incoming DM creates the lead and marks it unread", async () => {
  const s = newStore();
  await ingest(s, igIncoming());

  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].platform, "instagram");
  assert.equal(s.leads[0].name, "@mona.skin", "username is the display name when no name is sent");
  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.leads[0].hasUnread, true);
  const sourceLink = new URL(s.leads[0].conversationLink!);
  assert.equal(sourceLink.pathname, "/latest/inbox/instagram_direct");
  assert.equal(sourceLink.searchParams.get("selected_item_id"), "IGSID_1");
  assert.equal(sourceLink.searchParams.get("thread_type"), "IG_MESSAGE");
});

test("23 — IG outgoing echo clears unread and starts at 'sent'", async () => {
  const s = newStore();
  await ingest(s, igIncoming());
  await ingest(s, igOutgoing());

  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].hasUnread, false);
  assert.equal(s.messages.find((m) => m.platformMessageId === "mid.ig.out1")!.deliveryStatus, "sent");
});

test("24 — IG text + attachment keeps both", async () => {
  const s = newStore();
  await ingest(s, igIncoming({ message_text: "This spot", attachments: [image(0)] }));

  const m = s.contentMessages()[0];
  assert.equal(m.text, "This spot");
  assert.equal(s.attachments.filter((a) => a.messageId === m.id).length, 1);
});

test("25 — IG multiple attachments are all stored in order", async () => {
  const s = newStore();
  await ingest(s, igIncoming({ message_text: null, attachments: [image(0), image(1)] }));

  const m = s.contentMessages()[0];
  const atts = s.attachments.filter((a) => a.messageId === m.id);
  assert.equal(atts.length, 2);
  assert.deepEqual(
    atts.map((a) => a.index),
    [0, 1],
  );
});

test("26 — IG quick reply is one message with its payload", async () => {
  const s = newStore();
  await ingest(s, igIncoming({ message_text: "Prices", quick_reply_payload: "PRICES", quick_reply_text: "Prices" }));

  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.contentMessages()[0].quickReplyPayload, "PRICES");
});

test("27 — IG postback stores payload and title without a duplicate bubble", async () => {
  const s = newStore();
  await ingest(
    s,
    igIncoming({
      event_type: "postback",
      message_text: null,
      platform_message_id: "mid.ig.pb1",
      postback_payload: "BOOK",
      postback_title: "Book appointment",
    }),
  );

  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.contentMessages()[0].text, "Book appointment");
});

test("28 — IG referral records attribution without a bubble or unread", async () => {
  const s = newStore();
  await ingest(
    s,
    igIncoming({
      event_type: "referral",
      message_text: null,
      platform_message_id: null,
      referral_source: "IG_ADS",
      ad_id: "AD_IG_1",
      ad_name: "Laser IG",
    }),
  );

  assert.equal(s.contentMessages().length, 0);
  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].hasUnread, false);
  assert.equal(s.attribution[0].firstAdId, "AD_IG_1");
  assert.match(s.timeline[0].title, /Lead entered from Instagram/);
});

test("29 — IG reaction attaches to the target and creates no message", async () => {
  const s = newStore();
  await ingest(s, igIncoming());
  await ingest(s, igOutgoing());

  await ingest(
    s,
    igIncoming({
      event_type: "reaction",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(6),
      target_message_id: "mid.ig.out1",
      reaction_action: "react",
      reaction_type: "like",
      reaction_emoji: "👍",
    }),
  );

  assert.equal(s.contentMessages().length, 2);
  assert.equal(s.activeReactions("mid.ig.out1").length, 1);
  assert.equal(s.leads[0].hasUnread, false);
});

test("30 — IG unreaction clears the displayed reaction", async () => {
  const s = newStore();
  await ingest(s, igIncoming());
  await ingest(s, igOutgoing());

  const reaction = (action: string, minute: number) =>
    igIncoming({
      event_type: "reaction",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(minute),
      target_message_id: "mid.ig.out1",
      reaction_action: action,
      reaction_type: "like",
      reaction_emoji: "👍",
    });

  await ingest(s, reaction("react", 6));
  await ingest(s, reaction("unreact", 7));

  assert.equal(s.activeReactions("mid.ig.out1").length, 0);
  assert.equal(s.reactions.length, 2);
});

test("31 — IG read receipt uses target_message_id and marks that message Seen", async () => {
  const s = newStore();
  await ingest(s, igIncoming());
  await ingest(s, igOutgoing());

  await ingest(
    s,
    igIncoming({
      event_type: "read",
      message_text: null,
      platform_message_id: null,
      message_timestamp: at(9),
      status_for_direction: "outgoing",
      target_message_id: "mid.ig.out1",
    }),
  );

  const out = s.messages.find((m) => m.platformMessageId === "mid.ig.out1")!;
  assert.equal(out.deliveryStatus, "seen");
  assert.equal(s.contentMessages().length, 2);
  assert.equal(s.leads[0].hasUnread, false);
});

test("32 — IG message edit rewrites the original and records the old value", async () => {
  const s = newStore();
  await ingest(s, igIncoming({ message_text: "laser?" }));
  await ingest(
    s,
    igIncoming({
      event_type: "message_edit",
      platform_message_id: null,
      target_message_id: "mid.ig.in1",
      edited_text: "Do you do laser hair removal?",
      edit_count: 1,
      message_timestamp: at(2),
    }),
  );

  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.contentMessages()[0].text, "Do you do laser hair removal?");
  assert.equal(s.messageEdits[0].previousText, "laser?");
});

test("33 — IG unknown messaging event is stored and creates no lead", async () => {
  const s = newStore();
  await ingest(
    s,
    igIncoming({ event_type: "story_insights", message_text: null, platform_message_id: null, conversation_key: null }),
  );

  assert.equal(s.leads.length, 0);
  assert.equal(s.contentMessages().length, 0);
  assert.equal(s.conversationEvents.length, 1);
  assert.equal(s.conversationEvents[0].platform, "instagram");
});

test("34 — new IG comment creates the lead", async () => {
  const s = newStore();
  await ingest(s, igComment());

  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].platform, "instagram");
  assert.equal(s.comments[0].mediaId, "MEDIA1");
  const sourceLink = new URL(s.comments[0].commentLink!);
  assert.equal(sourceLink.pathname, "/latest/inbox/instagram");
  assert.equal(sourceLink.searchParams.get("selected_item_id"), "MEDIA1");
  assert.equal(sourceLink.searchParams.get("thread_type"), "INSTAGRAM_POST");
  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].hasUnread, true);
});

test("35 — IG comment reply is threaded", async () => {
  const s = newStore();
  await ingest(s, igComment());
  await ingest(
    s,
    igComment({
      comment_id: "igc_2",
      parent_comment_id: "igc_1",
      commenter_id: "IGCUSER_2",
      commenter_username: "ahmed",
      platform_user_id: "IGCUSER_2",
      comment_text: "+1",
      comment_timestamp: at(3),
    }),
  );

  const reply = s.comments.find((c) => c.commentId === "igc_2")!;
  assert.equal(reply.threadRole, "reply");
  assert.equal(reply.threadRootCommentId, "igc_1");
});

test("36 — IG business reply is distinguishable and creates no lead", async () => {
  const s = newStore();
  await ingest(s, igComment());
  await ingest(
    s,
    igComment({
      comment_id: "igc_3",
      parent_comment_id: "igc_1",
      is_page_or_business_reply: true,
      commenter_id: "IGACC1",
      commenter_username: "aspectsclinica",
      platform_user_id: "IGACC1",
      comment_text: "Sent you a DM",
      comment_timestamp: at(4),
    }),
  );

  const reply = s.comments.find((c) => c.commentId === "igc_3")!;
  assert.equal(reply.isPageOrBusinessReply, true);
  assert.equal(reply.threadRole, "business_reply");
  assert.equal(s.leads.length, 1);
});

test("37 — IG Live comment keeps its media product type for the Live badge", async () => {
  const s = newStore();
  await ingest(s, igComment({ comment_id: "igc_live", media_product_type: "ig_live", comment_text: "hello live" }));

  assert.equal(s.comments[0].mediaProductType, "ig_live");
});

/* ══ CROSS-CUTTING: 38–44 ═══════════════════════════════════════════════ */

test("38 — a duplicate webhook retry inserts nothing and reports success", async () => {
  const s = newStore();
  const body = fbIncoming();

  const first = await ingest(s, body);
  const retry = await ingest(s, body); // byte-identical replay

  assert.equal(first[0].created, true);
  assert.equal(retry[0].created, false);
  assert.equal(retry[0].skipped, true);
  assert.equal(retry[0].skipReason, "duplicate");

  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.leads.length, 1);
  assert.equal(s.leads[0].unreadMessageCount, 1, "a retry does not re-mark the lead unread");
  assert.equal(s.logs.length, 2, "both attempts are logged");
});

test("39 — a message with no platform_user_id is stored but creates no fake lead", async () => {
  const s = newStore();
  await ingest(
    s,
    fbIncoming({ platform_user_id: null, customer_psid: null, sender_id: null, conversation_key: "fb:PAGE1:orphan" }),
  );

  assert.equal(s.leads.length, 0, "no usable identity ⇒ no lead");
  assert.equal(s.conversations.length, 1, "the unmatched conversation remains available for later lead linking");
  assert.equal(s.contentMessages().length, 1, "the message is still stored, never dropped");
  assert.equal(s.contentMessages()[0].leadId, null);
});

test("40 — a weak (display-name) identity never creates or merges a lead", async () => {
  const s = newStore();

  const namesake = (over: Rec) =>
    fbIncoming({
      // The payload claims `strong`; the id shape says otherwise, and the id wins.
      platform_user_id: "facebook_name:Mona Ali",
      customer_psid: null,
      sender_id: null,
      identity_confidence: "strong",
      ...over,
    });

  await ingest(s, namesake({ platform_message_id: "mid.w1", conversation_key: "fb:PAGE1:w1" }));
  await ingest(
    s,
    namesake({ platform_message_id: "mid.w2", conversation_key: "fb:PAGE1:w2", message_timestamp: at(1) }),
  );

  assert.equal(s.leads.length, 0, "two people can share a display name — never merge on it");
  assert.equal(s.contentMessages().length, 2, "both messages are still stored");
  assert.equal(s.contentMessages()[0].identityConfidence, "weak", "a lying payload is downgraded");
});

test("41 — a missing sender name never blocks ingestion", async () => {
  const s = newStore();
  await ingest(s, fbIncoming({ sender_name: null, sent_by_name: null }));

  assert.equal(s.leads.length, 1, "a strong id is enough; the name is enrichment");
  assert.equal(s.leads[0].name, null);
  assert.equal(s.contentMessages().length, 1);
});

test("42 — multiple entries in one webhook request are all ingested", async () => {
  const s = newStore();
  await ingest(s, {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        time: ms(0),
        messaging: [
          {
            sender: { id: "PSID_A" },
            recipient: { id: "PAGE1" },
            timestamp: ms(0),
            message: { mid: "mid.a", text: "from A" },
          },
        ],
      },
      {
        id: "PAGE1",
        time: ms(1),
        messaging: [
          {
            sender: { id: "PSID_B" },
            recipient: { id: "PAGE1" },
            timestamp: ms(1),
            message: { mid: "mid.b", text: "from B" },
          },
        ],
      },
    ],
  });

  assert.equal(s.leads.length, 2, "two distinct people, two leads");
  assert.equal(s.contentMessages().length, 2);
});

test("43 — multiple messaging events in one entry: one lead, SLA clock starts on the first", async () => {
  const s = newStore();
  await ingest(s, {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        time: ms(0),
        messaging: [
          {
            sender: { id: "PSID_C" },
            recipient: { id: "PAGE1" },
            timestamp: ms(0),
            message: { mid: "mid.c1", text: "hi" },
          },
          {
            sender: { id: "PSID_C" },
            recipient: { id: "PAGE1" },
            timestamp: ms(5),
            message: { mid: "mid.c2", text: "are you there?" },
          },
        ],
      },
    ],
  });

  assert.equal(s.leads.length, 1, "one person is one lead, however many messages they send");
  assert.equal(s.contentMessages().length, 2);

  const lead = s.leads[0];
  assert.equal(lead.unreadMessageCount, 2);
  assert.equal(lead.unreadSince, T0);
  assert.equal(lead.replyOverdueAt, at(REPLY_SLA_MINUTES), "a chatty patient cannot postpone their own SLA");
});

test("44 — multiple changes in one entry become separate comments", async () => {
  const s = newStore();
  await ingest(s, {
    object: "page",
    entry: [
      {
        id: "PAGE1",
        time: ms(0),
        changes: [
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "fbc_x",
              post_id: "POST9",
              from: { id: "CU_X", name: "Nour" },
              message: "first",
              created_time: Math.floor(ms(0) / 1000),
            },
          },
          {
            field: "feed",
            value: {
              item: "comment",
              verb: "add",
              comment_id: "fbc_y",
              post_id: "POST9",
              from: { id: "CU_Y", name: "Hana" },
              message: "second",
              created_time: Math.floor(ms(1) / 1000),
            },
          },
        ],
      },
    ],
  });

  assert.equal(s.comments.length, 2);
  assert.deepEqual(
    s.comments.map((c) => c.commentId),
    ["fbc_x", "fbc_y"],
  );
  assert.equal(s.leads.length, 2);
});

test("45 — n8n Webhook body wrapper preserves an entry-level Instagram comment", async () => {
  const s = newStore();
  await ingest(s, {
    headers: { "user-agent": "facebookplatform/1.0" },
    body: {
      object: "instagram",
      entry: [{
        id: "IGACC1",
        time: ms(0),
        field: "comments",
        value: {
          id: "igc_wrapped",
          from: { id: "IGSID_WRAPPED", username: "wrapped.patient" },
          text: "This comment must not disappear",
          media: { id: "MEDIA_WRAPPED", media_product_type: "FEED" },
        },
      }],
    },
  });

  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].commentId, "igc_wrapped");
  assert.equal(s.comments[0].text, "This comment must not disappear");
  assert.equal(s.comments[0].instagramAccountId, "IGACC1");
  assert.equal(s.leads.length, 1);
});

test("46 — documented Instagram self comment is captured as outgoing clinic work", async () => {
  const s = newStore();
  await ingest(s, {
    object: "instagram",
    entry: [{
      id: "IGACC1",
      time: ms(0),
      changes: [{
        field: "comments",
        value: {
          id: "igc_self",
          from: { id: "IGACC1", username: "aspectsclinica", self_ig_scoped_id: "SELF_IGSID" },
          text: "Clinic reply",
          media: { id: "MEDIA1", media_product_type: "FEED" },
        },
      }],
    }],
  });

  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].direction, "outgoing");
  assert.equal(s.comments[0].isPageOrBusinessReply, true);
  assert.equal(s.leads.length, 0, "our own public reply cannot create a patient lead");
});

test("47 — a partial n8n comment recovers all native fields from raw_payload", async () => {
  const s = newStore();
  await ingest(s, {
    record_type: "comment",
    platform: "facebook",
    page_id: "PAGE1",
    webhook_object: "page",
    webhook_change_field: "feed",
    raw_payload: {
      field: "feed",
      value: {
        item: "comment",
        verb: "add",
        comment_id: "fbc_recovered",
        post_id: "POST_RECOVERED",
        from: { id: "FB_RECOVERED", name: "Recovered Patient" },
        message: "Recovered comment text",
        created_time: Math.floor(ms(0) / 1000),
      },
    },
  });

  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].commentId, "fbc_recovered");
  assert.equal(s.comments[0].commenterId, "FB_RECOVERED");
  assert.equal(s.comments[0].text, "Recovered comment text");
  assert.equal(s.leads.length, 1);
});

test("48 — an empty data property cannot hide a valid Meta entry envelope", async () => {
  const s = newStore();
  await ingest(s, {
    object: "page",
    data: [],
    entry: [{
      id: "PAGE1",
      time: ms(0),
      changes: [{
        field: "feed",
        value: {
          item: "comment",
          verb: "add",
          comment_id: "fbc_entry_wins",
          from: { id: "FB_ENTRY", name: "Entry Patient" },
          message: "Entry must win",
        },
      }],
    }],
  });
  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].commentId, "fbc_entry_wins");
});

test("49 — CRM rebuilds a broken n8n conversation link for an existing lead", async () => {
  const s = newStore();
  await ingest(s, fbIncoming({ chat_link: "https://broken.invalid/PSID_1" }));
  await ingest(s, fbIncoming({
    // Same webhook replayed after n8n resolves the Meta conversation. The
    // bubble dedupes, but the richer link metadata must still be applied.
    platform_message_id: "mid.in1",
    message_timestamp: at(1),
    conversation_link: "https://www.facebook.com/PAGE1/inbox/THREAD1/?section=messages",
    fallback_inbox_link: "https://business.facebook.com/latest/inbox/all",
  }));

  assert.equal(s.leads.length, 1);
  assert.equal(s.contentMessages().length, 1);
  const repaired = new URL(s.leads[0].conversationLink!);
  assert.equal(repaired.pathname, "/latest/inbox/all");
  assert.equal(repaired.searchParams.get("asset_id"), "PAGE1");
  assert.equal(repaired.searchParams.get("selected_item_id"), "PSID_1");
  assert.equal(repaired.searchParams.get("thread_type"), "FB_MESSAGE");
  assert.equal(s.leads[0].fallbackInboxLink, "https://business.facebook.com/latest/inbox/all");
});

test("50 — Instagram is_self messages are outgoing and never create patient leads", async () => {
  const s = newStore();
  await ingest(s, {
    object: "instagram",
    entry: [{
      id: "IGACC1",
      time: ms(0),
      messaging: [{
        sender: { id: "IGACC1" },
        recipient: { id: "IGSID_TEST" },
        timestamp: ms(0),
        message: { mid: "mid.self", text: "Test reply", is_self: true },
      }],
    }],
  });

  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.contentMessages()[0].direction, "outgoing");
  assert.equal(s.leads.length, 0);
});

test("51 — Instagram username-only comment remains visible through a safe medium identity", async () => {
  const s = newStore();
  await ingest(s, {
    object: "instagram",
    entry: [{
      id: "IGACC1",
      time: ms(0),
      field: "comments",
      value: {
        id: "igc_username_only",
        from: { username: "username.only" },
        text: "Meta omitted my scoped id",
        media: { id: "MEDIA1", media_product_type: "FEED" },
      },
    }],
  });

  assert.equal(s.comments.length, 1);
  assert.equal(s.comments[0].platformUserId, "instagram_username:username.only");
  assert.equal(s.comments[0].identityConfidence, "medium");
  assert.equal(s.leads.length, 1, "the comment must be attached to a searchable lead");
});

test("52 — Meta echo truth overrides a stale incoming direction from n8n", async () => {
  const s = newStore();
  await ingest(s, fbOutgoing({ direction: "incoming" }));
  assert.equal(s.contentMessages().length, 1);
  assert.equal(s.contentMessages()[0].direction, "outgoing");
  assert.equal(s.leads.length, 0, "our sent echo cannot fabricate an incoming lead");
});

/* ══ dashboard-level invariant ═════════════════════════════════════════ */

test("status events never inflate Total Messages, Total Leads, unread or SLA", async () => {
  const s = newStore();
  await ingest(s, fbIncoming());
  await ingest(s, fbOutgoing());

  const leads = s.leads.length;
  const messages = s.contentMessages().length;

  // Every non-content event type, one after another.
  await ingest(s, fbIncoming({ event_type: "delivery", message_text: null, platform_message_id: null, message_timestamp: at(6), delivered_message_ids: ["mid.out1"], status_for_direction: "outgoing" }));
  await ingest(s, fbIncoming({ event_type: "read", message_text: null, platform_message_id: null, message_timestamp: at(7), status_watermark: ms(6), status_for_direction: "outgoing" }));
  await ingest(s, fbIncoming({ event_type: "reaction", message_text: null, platform_message_id: null, message_timestamp: at(8), target_message_id: "mid.out1", reaction_action: "react", reaction_emoji: "❤" }));
  await ingest(s, fbIncoming({ event_type: "referral", message_text: null, platform_message_id: null, message_timestamp: at(9), referral_source: "ADS", ad_id: "AD9" }));
  await ingest(s, fbIncoming({ event_type: "optin", message_text: null, platform_message_id: null, message_timestamp: at(10) }));
  await ingest(s, fbIncoming({ event_type: "account_linking", message_text: null, platform_message_id: null, message_timestamp: at(11) }));
  await ingest(s, fbIncoming({ event_type: "policy_enforcement", message_text: null, platform_message_id: null, message_timestamp: at(12) }));
  await ingest(s, fbIncoming({ event_type: "who_knows", message_text: null, platform_message_id: null, message_timestamp: at(13) }));

  assert.equal(s.leads.length, leads, "Total Leads unchanged");
  assert.equal(s.contentMessages().length, messages, "Total Messages unchanged");
  assert.equal(s.leads[0].hasUnread, false, "Incoming-unanswered unchanged");
  assert.equal(s.leads[0].replyOverdueAt, null, "SLA unchanged");

  // …and yet not one of them was dropped. A reaction that finds its target is
  // retained on the reaction table rather than the conversation-event table.
  assert.deepEqual(
    [...new Set(s.conversationEvents.map((e) => e.eventType))].sort(),
    ["account_linking", "delivery", "optin", "policy_enforcement", "read", "referral", "unknown"],
  );
  assert.equal(s.reactions.length, 1, "the reaction is stored against its target message");
});

test("n8n payload recovers Meta message identifiers from raw_payload", async () => {
  const s = newStore();
  const raw = {
    sender: { id: "PSID_RAW" },
    recipient: { id: "PAGE1" },
    timestamp: ms(0),
    message: { mid: "mid.raw.1", text: "Preserve me" },
  };

  await ingest(s, {
    record_type: "message",
    event_type: "message",
    platform: "facebook",
    page_id: "PAGE1",
    platform_user_id: "PSID_RAW",
    identity_confidence: "strong",
    conversation_key: "fb:PAGE1:PSID_RAW",
    direction: "incoming",
    message_text: "Preserve me",
    message_timestamp: T0,
    raw_payload: raw,
  });

  assert.equal(s.messages.length, 1);
  assert.equal(s.messages[0].platformMessageId, "mid.raw.1");
  assert.equal(s.messages[0].senderId, "PSID_RAW");
  assert.equal(s.messages[0].recipientId, "PAGE1");

  await ingest(s, {
    record_type: "message",
    event_type: "message",
    platform: "facebook",
    page_id: "PAGE1",
    platform_user_id: "PSID_RAW",
    identity_confidence: "strong",
    conversation_key: "fb:PAGE1:PSID_RAW",
    direction: "incoming",
    message_text: "Preserve me",
    message_timestamp: T0,
    raw_payload: raw,
  });
  assert.equal(s.messages.length, 1, "recovered mid remains the dedupe key on retry");
});
