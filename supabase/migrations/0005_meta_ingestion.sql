-- ============================================================================
-- 0005_meta_ingestion.sql
--
-- Facebook / Instagram message + comment ingestion, upgraded for the new n8n
-- normalizers (messages: message/postback/referral/reaction/delivery/read/
-- message_edit/unknown/optin/account_linking/policy_enforcement; comments:
-- created/updated/deleted/unknown).
--
-- HOW TO APPLY: CRM Supabase project (wgczgrhcqishvhbitvml) → SQL Editor →
-- paste this whole file → Run. Safe to run more than once.
--
-- SAFETY CONTRACT
--  * Additive only. Nothing is dropped, renamed, or retyped.
--  * Every existing column keeps its meaning; existing rows keep working.
--  * All new columns are nullable or have defaults, so historical rows backfill
--    to sane values (see the `is_conversation_content` backfill below).
--  * All new tables enable RLS with no permissive policy → service-role only,
--    matching every other CRM table until real auth + per-role policies land.
--  * Unique indexes are partial (`where ... is not null`) so the existing rows,
--    which have NULL platform identifiers, never collide.
--
-- DESIGN NOTES
--  * `crm_messages` stays the home of CONTENT-BEARING events only (a real chat
--    bubble: text, attachment, quick reply, postback, edited message).
--  * Non-content events (delivery, read, referral, reaction, unknown, optin,
--    account_linking, policy_enforcement) go to `crm_conversation_events`.
--    They must never inflate Total Messages, unread counts, or SLA timers, so
--    keeping them out of `crm_messages` makes that structurally impossible
--    rather than merely a convention the app has to remember.
--  * `crm_messages.is_conversation_content` exists so a future event type that
--    does land in `crm_messages` can still be excluded from KPI counts.
--  * Attachments are one-to-many (`crm_message_attachments`), preserving the
--    platform's original ordering via `attachment_index`. The legacy
--    `attachment_url` column is kept and populated with attachment[0] purely so
--    the existing read path keeps rendering; new code reads the child table.
-- ============================================================================


-- ════════════════════════════════════════════════════════════════════════════
-- 1. crm_messages — content-bearing events
-- ════════════════════════════════════════════════════════════════════════════

alter table crm_messages add column if not exists record_type             text not null default 'message';
alter table crm_messages add column if not exists event_type              text not null default 'message';
alter table crm_messages add column if not exists event_action            text;

-- Routing / identity
alter table crm_messages add column if not exists page_id                 text;
alter table crm_messages add column if not exists recipient_page_id       text;
alter table crm_messages add column if not exists customer_psid           text;
alter table crm_messages add column if not exists customer_instagram_id   text;
alter table crm_messages add column if not exists identity_confidence     text;
alter table crm_messages add column if not exists sender_id               text;
alter table crm_messages add column if not exists recipient_id            text;
alter table crm_messages add column if not exists sender_name             text;
alter table crm_messages add column if not exists sender_username         text;
alter table crm_messages add column if not exists sender_phone            text;

-- Content shape
alter table crm_messages add column if not exists attachment_count        integer not null default 0;
alter table crm_messages add column if not exists message_is_deleted      boolean not null default false;
alter table crm_messages add column if not exists message_is_unsupported  boolean not null default false;
alter table crm_messages add column if not exists message_metadata        jsonb;

-- Quick replies + postbacks (rendered inline, never as a second bubble)
alter table crm_messages add column if not exists quick_reply_payload     text;
alter table crm_messages add column if not exists quick_reply_text        text;
alter table crm_messages add column if not exists postback_payload        text;
alter table crm_messages add column if not exists postback_title          text;

-- Replies
alter table crm_messages add column if not exists reply_to_message_id     text;
alter table crm_messages add column if not exists reply_to                jsonb;

-- Edits (full history lives in crm_message_edits)
alter table crm_messages add column if not exists edit_count              integer not null default 0;
alter table crm_messages add column if not exists edited_at               timestamptz;

-- Outgoing delivery lifecycle, driven by delivery/read receipts
alter table crm_messages add column if not exists delivery_status         text;
alter table crm_messages add column if not exists delivered_at            timestamptz;
alter table crm_messages add column if not exists seen_at                 timestamptz;

-- Deep links
alter table crm_messages add column if not exists chat_link               text;
alter table crm_messages add column if not exists conversation_link       text;
alter table crm_messages add column if not exists fallback_inbox_link     text;
alter table crm_messages add column if not exists page_inbox_link         text;

-- Ad attribution carried on the message that arrived with a referral
alter table crm_messages add column if not exists campaign                text;
alter table crm_messages add column if not exists ad_id                   text;
alter table crm_messages add column if not exists ad_name                 text;
alter table crm_messages add column if not exists referral_source         text;
alter table crm_messages add column if not exists referral_type           text;
alter table crm_messages add column if not exists referral_code           text;
alter table crm_messages add column if not exists referral                jsonb;

-- Provenance
alter table crm_messages add column if not exists webhook_object          text;
alter table crm_messages add column if not exists webhook_event_keys      jsonb;
alter table crm_messages add column if not exists service                 text;
alter table crm_messages add column if not exists doctor                  text;
alter table crm_messages add column if not exists branch                  text;

-- The KPI / unread / SLA gate. Only `true` rows are "a real message".
alter table crm_messages add column if not exists is_conversation_content boolean not null default true;

-- Deterministic idempotency key for rows that have no platform_message_id.
alter table crm_messages add column if not exists event_key               text;

comment on column crm_messages.is_conversation_content is
  'True for real chat bubbles. Status/system events must be false so they never inflate Total Messages, unread counts, or SLA timers.';
comment on column crm_messages.delivery_status is
  'Outgoing lifecycle: sent | delivered | seen. NULL for incoming messages.';
comment on column crm_messages.attachment_url is
  'LEGACY: first attachment only, kept so pre-0005 read paths keep working. New code must read crm_message_attachments.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_messages_delivery_status_ck') then
    alter table crm_messages add constraint crm_messages_delivery_status_ck
      check (delivery_status is null or delivery_status in ('sent','delivered','seen'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_messages_identity_confidence_ck') then
    alter table crm_messages add constraint crm_messages_identity_confidence_ck
      check (identity_confidence is null or identity_confidence in ('strong','medium','weak','none'));
  end if;
end $$;

-- Webhook-retry idempotency. Partial so the 10 pre-existing rows (NULL ids) are
-- unaffected, and so a platform that omits the id falls back to event_key.
create unique index if not exists crm_messages_platform_msgid_uk
  on crm_messages (platform, platform_message_id)
  where platform_message_id is not null;

create unique index if not exists crm_messages_event_key_uk
  on crm_messages (event_key)
  where event_key is not null;

create index if not exists crm_messages_lead_at_idx      on crm_messages (lead_id, message_at);
create index if not exists crm_messages_conv_at_idx      on crm_messages (conversation_id, message_at);
create index if not exists crm_messages_content_idx      on crm_messages (lead_id) where is_conversation_content;
create index if not exists crm_messages_reply_to_idx     on crm_messages (reply_to_message_id) where reply_to_message_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. crm_message_attachments — one row per attachment, original order preserved
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists crm_message_attachments (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null references crm_messages(id) on delete cascade,
  attachment_index integer not null,
  type             text,
  raw_type         text,
  url              text,
  title            text,
  name             text,
  sticker_id       text,
  payload          jsonb,
  created_at       timestamptz not null default now()
);

create unique index if not exists crm_message_attachments_uk
  on crm_message_attachments (message_id, attachment_index);
create index if not exists crm_message_attachments_by_message
  on crm_message_attachments (message_id);

comment on column crm_message_attachments.attachment_index is
  'Zero-based position in the platform''s attachments array. Render in this order.';
comment on column crm_message_attachments.raw_type is
  'Platform-reported type, preserved verbatim so future/unknown types are not lost.';


-- ════════════════════════════════════════════════════════════════════════════
-- 3. crm_message_reactions — current state + full audit history
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists crm_message_reactions (
  id                      uuid primary key default gen_random_uuid(),
  message_id              uuid references crm_messages(id) on delete cascade,
  -- Kept as text too: a reaction can arrive before its target message does.
  target_message_id       text not null,
  platform                text not null,
  actor_platform_user_id  text,
  reaction_action         text not null,          -- react | unreact
  reaction_type           text,
  reaction_emoji          text,
  reacted_at              timestamptz not null,
  is_active               boolean not null default true,
  event_key               text not null,
  raw_payload             jsonb,
  created_at              timestamptz not null default now()
);

-- One row per distinct platform event → retries collapse, history is retained.
create unique index if not exists crm_message_reactions_event_key_uk
  on crm_message_reactions (event_key);
create index if not exists crm_message_reactions_by_message on crm_message_reactions (message_id);
create index if not exists crm_message_reactions_by_target  on crm_message_reactions (platform, target_message_id);

comment on table crm_message_reactions is
  'Append-only reaction log. is_active reflects the latest react/unreact for a given (target, actor, reaction) so the UI can render current reactions while auditing keeps every event.';


-- ════════════════════════════════════════════════════════════════════════════
-- 4. crm_message_edits — previous value / new value / when / which revision
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists crm_message_edits (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references crm_messages(id) on delete cascade,
  edit_count    integer not null,
  previous_text text,
  new_text      text,
  edited_at     timestamptz not null,
  raw_payload   jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists crm_message_edits_uk
  on crm_message_edits (message_id, edit_count);
create index if not exists crm_message_edits_by_message on crm_message_edits (message_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 5. crm_conversation_events — the safe sink for every non-content event
--
-- delivery | read | referral | reaction | unknown | optin | account_linking |
-- policy_enforcement. Nothing here is a chat bubble; nothing here creates a
-- lead on its own; nothing here touches unread or SLA.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists crm_conversation_events (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid references leads(id) on delete cascade,
  conversation_id       uuid references crm_conversations(id) on delete cascade,
  source                text,
  platform              text not null,
  record_type           text,
  event_type            text not null,
  event_action          text,
  page_id               text,
  instagram_account_id  text,
  platform_user_id      text,
  identity_confidence   text,
  conversation_key      text,
  direction             text,
  status_for_direction  text,
  target_message_id     text,
  delivered_message_ids text[],
  status_watermark      timestamptz,
  -- referral / attribution
  referral_source       text,
  referral_type         text,
  referral_code         text,
  campaign              text,
  ad_id                 text,
  ad_name               text,
  referral              jsonb,
  -- provenance
  webhook_object        text,
  webhook_event_keys    jsonb,
  event_at              timestamptz not null,
  event_key             text not null,
  raw_payload           jsonb,
  created_at            timestamptz not null default now()
);

create unique index if not exists crm_conversation_events_event_key_uk
  on crm_conversation_events (event_key);
create index if not exists crm_conversation_events_by_lead on crm_conversation_events (lead_id, event_at desc);
create index if not exists crm_conversation_events_by_type on crm_conversation_events (event_type, event_at desc);
create index if not exists crm_conversation_events_by_target
  on crm_conversation_events (platform, target_message_id) where target_message_id is not null;

comment on table crm_conversation_events is
  'Every non-content Meta event. Deliberately separate from crm_messages so status events can never be counted as messages, unread, or SLA-triggering.';


-- ════════════════════════════════════════════════════════════════════════════
-- 6. crm_lead_attribution — first-touch frozen, latest-touch mutable
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists crm_lead_attribution (
  lead_id                 uuid primary key references leads(id) on delete cascade,
  -- FIRST TOUCH: written once, never overwritten.
  first_source            text,
  first_campaign          text,
  first_ad_id             text,
  first_ad_name           text,
  first_referral_source   text,
  first_referral_type     text,
  first_referral_code     text,
  first_touch_at          timestamptz,
  first_referral          jsonb,
  -- LATEST TOUCH: updated on every subsequent referral.
  latest_source           text,
  latest_campaign         text,
  latest_ad_id            text,
  latest_ad_name          text,
  latest_referral_source  text,
  latest_referral_type    text,
  latest_referral_code    text,
  latest_touch_at         timestamptz,
  latest_referral         jsonb,
  touch_count             integer not null default 0,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists crm_lead_attribution_first_campaign_idx on crm_lead_attribution (first_campaign);
create index if not exists crm_lead_attribution_first_ad_idx       on crm_lead_attribution (first_ad_id);

comment on column crm_lead_attribution.first_touch_at is
  'Set exactly once, on the first referral that carries a usable identity. Later referrals only move the latest_* columns.';


-- ════════════════════════════════════════════════════════════════════════════
-- 7. crm_conversations — identity + receipt watermarks
-- ════════════════════════════════════════════════════════════════════════════

alter table crm_conversations add column if not exists identity_confidence   text;
alter table crm_conversations add column if not exists customer_psid         text;
alter table crm_conversations add column if not exists customer_instagram_id text;
alter table crm_conversations add column if not exists last_incoming_at      timestamptz;
alter table crm_conversations add column if not exists last_delivered_at     timestamptz;
alter table crm_conversations add column if not exists last_seen_at          timestamptz;

create unique index if not exists crm_conversations_conversation_key_uk
  on crm_conversations (conversation_key)
  where conversation_key is not null;

create index if not exists crm_conversations_platform_user_idx
  on crm_conversations (platform, platform_user_id) where platform_user_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 8. crm_comments — threading, lifecycle, media, attribution
-- ════════════════════════════════════════════════════════════════════════════

alter table crm_comments add column if not exists record_type            text not null default 'comment';
alter table crm_comments add column if not exists event_type             text not null default 'comment';
alter table crm_comments add column if not exists event_action           text;

-- Threading
alter table crm_comments add column if not exists thread_root_comment_id text;
alter table crm_comments add column if not exists raw_parent_id          text;
alter table crm_comments add column if not exists is_reply               boolean not null default false;
alter table crm_comments add column if not exists thread_role            text;

-- Lifecycle
alter table crm_comments add column if not exists is_edited              boolean not null default false;
alter table crm_comments add column if not exists is_deleted             boolean not null default false;
alter table crm_comments add column if not exists deleted_at             timestamptz;
alter table crm_comments add column if not exists edit_count             integer not null default 0;

-- Media
alter table crm_comments add column if not exists media_type             text;
alter table crm_comments add column if not exists media_product_type     text;
alter table crm_comments add column if not exists attachment_count       integer not null default 0;

-- Identity + attribution
alter table crm_comments add column if not exists identity_confidence    text;
alter table crm_comments add column if not exists ad_id                  text;

-- Provenance
alter table crm_comments add column if not exists facebook_verb_raw      text;
alter table crm_comments add column if not exists event_source_field     text;
alter table crm_comments add column if not exists webhook_object         text;
alter table crm_comments add column if not exists webhook_change_field   text;

comment on column crm_comments.is_deleted is
  'Deletion is a state change, never a row removal: the audit trail and the "Comment deleted" UI both depend on the row surviving.';
comment on column crm_comments.thread_role is
  'top_level | reply | business_reply — derived by the normalizer, used to nest the Comments tab.';
comment on column crm_comments.attachment_url is
  'LEGACY: first attachment only. New code must read crm_comment_attachments.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_comments_identity_confidence_ck') then
    alter table crm_comments add constraint crm_comments_identity_confidence_ck
      check (identity_confidence is null or identity_confidence in ('strong','medium','weak','none'));
  end if;
end $$;

create unique index if not exists crm_comments_platform_comment_uk
  on crm_comments (platform, comment_id)
  where comment_id is not null;

create index if not exists crm_comments_by_lead    on crm_comments (lead_id, comment_timestamp);
create index if not exists crm_comments_by_thread  on crm_comments (comment_thread_key, comment_timestamp);
create index if not exists crm_comments_by_root    on crm_comments (thread_root_comment_id) where thread_root_comment_id is not null;
create index if not exists crm_comments_by_parent  on crm_comments (parent_comment_id) where parent_comment_id is not null;
create index if not exists crm_comments_by_post    on crm_comments (post_id) where post_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- 9. crm_comment_attachments / crm_comment_edits
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists crm_comment_attachments (
  id               uuid primary key default gen_random_uuid(),
  comment_id       uuid not null references crm_comments(id) on delete cascade,
  attachment_index integer not null,
  type             text,
  raw_type         text,
  url              text,
  title            text,
  name             text,
  sticker_id       text,
  payload          jsonb,
  created_at       timestamptz not null default now()
);

create unique index if not exists crm_comment_attachments_uk
  on crm_comment_attachments (comment_id, attachment_index);
create index if not exists crm_comment_attachments_by_comment on crm_comment_attachments (comment_id);

create table if not exists crm_comment_edits (
  id            uuid primary key default gen_random_uuid(),
  comment_id    uuid not null references crm_comments(id) on delete cascade,
  revision      integer not null,
  previous_text text,
  new_text      text,
  change_type   text not null default 'updated',   -- updated | deleted
  edited_at     timestamptz not null,
  raw_payload   jsonb,
  created_at    timestamptz not null default now()
);

create unique index if not exists crm_comment_edits_uk
  on crm_comment_edits (comment_id, revision);
create index if not exists crm_comment_edits_by_comment on crm_comment_edits (comment_id);


-- ════════════════════════════════════════════════════════════════════════════
-- 10. crm_ingest_logs — a couple of fields the new pipeline reports
-- ════════════════════════════════════════════════════════════════════════════

alter table crm_ingest_logs add column if not exists event_type    text;
alter table crm_ingest_logs add column if not exists event_action  text;
alter table crm_ingest_logs add column if not exists event_key     text;
alter table crm_ingest_logs add column if not exists skipped       boolean not null default false;
alter table crm_ingest_logs add column if not exists skip_reason   text;

create index if not exists crm_ingest_logs_event_key_idx on crm_ingest_logs (event_key) where event_key is not null;
create index if not exists crm_ingest_logs_created_idx   on crm_ingest_logs (created_at desc);


-- ════════════════════════════════════════════════════════════════════════════
-- 11. Backfill: historical rows are all genuine content.
--     (No-op on re-run; the default already covers rows inserted after 0005.)
-- ════════════════════════════════════════════════════════════════════════════

update crm_messages
   set is_conversation_content = true
 where is_conversation_content is distinct from true
   and event_type = 'message';

update crm_messages
   set attachment_count = 1
 where attachment_url is not null
   and attachment_count = 0;


-- ════════════════════════════════════════════════════════════════════════════
-- 12. RLS on every new table (no policy → service-role only)
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'crm_message_attachments',
    'crm_message_reactions',
    'crm_message_edits',
    'crm_conversation_events',
    'crm_lead_attribution',
    'crm_comment_attachments',
    'crm_comment_edits'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
