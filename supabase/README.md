# Supabase — source of truth

The live Supabase project **already contains the full CRM schema** (55 public
tables) with reference data and settings. That live schema — not any file in
this repo — is the source of truth.

The app reads/writes it through the adapter in
[`lib/data/supabase.ts`](../lib/data/supabase.ts), which maps real rows to the
UI view models. Selected at runtime by `CRM_DATA_SOURCE` (`supabase` | `mock`).

## Key tables the app currently uses

- `leads` — core lead record (`lead_id` human id, `status` pipeline stage,
  `platform`, `service_name`, `has_unread`, `is_reply_overdue`,
  `escalation_status`, `coordinator_user_id`, `ai_*` columns, …).
- `crm_users` — operators (Supabase Auth + booking-system links, `role`).
- `lead_sources`, `lost_reasons`, `crm_escalation_reasons` — reference data.
- `crm_conversations` / `crm_messages` / `crm_comments` — unified message model.
- `escalations`, `lead_duplicate_flags`, `lead_timeline_events`,
  `lead_status_history`.
- `audit_daily_reports` (+ `audit_*`), `crm_settings`, `crm_integrations`.

### Enum values (verbatim)

- `leads.status`: `new_lead, qualified, booked, follow_up, post_op_follow_up, lost`
- `leads.escalation_status` / `escalations.status`: `none, escalated, in_review, resolved`
- `crm_users.role`: `owner_admin, manager, moderator, doctor, viewer, auditor`
- `audit_daily_reports.status`: `draft, submitted, approved, reopened`

The UI keeps a slightly shorter pipeline enum (`new`, `post_op`); the adapter
translates both directions.

## `archive/`

`archive/0001_init.sql.obsolete` is an **early invented schema draft**. It does
NOT match the live database and must never be applied — kept only for reference.
Do not add new migrations here without reconciling against the live schema.
