-- 0006_crm_comments_event_key.sql
--
-- Repairs an omission in 0005: `crm_comments` gained every other normalizer
-- column but not `event_key`, while `store.supabase.ts` both writes it on
-- insert and filters on it in `findCommentByEventKey()`. Against the live
-- schema every comment insert therefore failed with PGRST204.
--
-- 0005 is already applied in production, so this is fixed forward rather than
-- by editing that file.
--
-- Additive and idempotent. No data loss, no destructive change.

alter table crm_comments add column if not exists event_key text;

comment on column crm_comments.event_key is
  'Deterministic idempotency key derived from the event content. The primary '
  'dedupe path is the unique (platform, comment_id) index; this is the fallback '
  'for platforms that omit a comment id, and is never derived from received_at.';

-- Partial, because a comment that carries a platform `comment_id` dedupes on
-- that instead and leaves this null — and nulls must not collide with one
-- another under a unique constraint.
create unique index if not exists crm_comments_event_key_uk
  on crm_comments (event_key)
  where event_key is not null;
