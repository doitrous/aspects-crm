# Aspects Clinica CRM — Integrations & Open Decisions

Status as of Phase 4 completion. This is the single source of truth for **what is
wired, what keys are needed, and what I need from you** to finish Phases 5–6.

Design rule in force: the CRM keeps its **own** visual language. It borrows the
booking/admin platform's **rules** (status model, double-booking logic) but never
its design. The booking/admin side may borrow from the CRM, not the reverse.

---

## 0. Two separate Supabase projects

| Project | Ref | Used for |
| --- | --- | --- |
| **CRM** | `wgczgrhcqishvhbitvml` | Leads, reports, settings, ingest receiver |
| **Booking** | `kuaoowjnatgixcupqdac` | Public website reservations, doctors, schedules |

The CRM talks to the booking project two ways:

1. **Federated read** (built): the CRM reads booking `appointments` directly via a
   server-only client using `BOOKING_SUPABASE_*`. Powers **Patient Reservations**
   and **Calendar**. No data is copied.
2. **Ingest push** (receiver built, sender pending): the booking site / n8n POSTs
   each new reservation to the CRM, which creates/links an **unread lead**.

> **Decision needed (D1):** Approve the federated-read approach — the booking
> project's `service_role` key now lives in the CRM's `.env.local` (gitignored,
> server-only, never shipped to the browser). Alternative is a REST proxy on the
> booking side (`BOOKING_API_BASE_URL` + `BOOKING_API_KEY`) if you'd rather not
> share the service key. I recommend keeping federated read.

---

## 1. Phase 4 — Live booking connection ✅ COMPLETE

- **Patient Reservations** tab (`/reservations`) — lists live bookings, newest
  first; new-patient + "New/unread" badges; status badges mirror the admin status
  model. Verified against 7 live appointments.
- **Calendar** (`/calendar`) — CRM-native month grid, Sun→Sat, follows the admin
  calendar's rules (cancelled reservations hidden; active statuses occupy slots),
  month navigation, today highlight. Verified for July + June 2026.
- **Ingest receiver** `POST /api/ingest/reservation` — **built + live-smoke-tested**
  (create → `new_lead` unread; idempotent re-post → update, no duplicates; bad key
  → 401; test row cleaned up).

### Ingest contract (what the booking site / n8n must send)

```
POST {CRM_APP_URL}/api/ingest/reservation
Header:  x-api-key: {CRM_INGEST_API_KEY}      (or Authorization: Bearer {key})
Body (JSON):
{
  "bookingAppointmentId": "<uuid>",   // REQUIRED — booking appointments.id (uuid)
  "patientName": "…",                 // REQUIRED
  "phoneCountryCode": "+20",
  "phoneNumber": "01…",
  "patientEmail": "…",
  "serviceName": "…", "doctorName": "…", "branchName": "…", "specialtyName": "…",
  "appointmentDate": "2026-07-25", "startTime": "10:00",
  "isNewPatient": true, "primaryComplaint": "…", "referralSource": "…",
  "feeAtBooking": 500, "createdAt": "<ISO booked-at>"
}
```

Dedupe logic: match on `booking_appointment_id` → update; else match on
`normalized_phone` → link + mark unread; else insert a new `new_lead` with
`has_unread=true`. `lead_id` (e.g. `L0111`) is auto-generated.

> **Decision needed (D2):** How should a booking map to a lead?
> - (a) **Always create/refresh a lead** for every reservation (current behavior), or
> - (b) only create a lead for **new patients**, and just flag returning patients?
>
> **Decision needed (D3):** Two small Supabase touches to make booking leads
> first-class (optional but recommended):
> - Add `website_booking` to the `leads.platform` allowed values (right now I use
>   `platform='manual'` + `metadata.channel='website_booking'`).
> - Create a `lead_sources` row for "Website booking" and give me its id for
>   `CRM_BOOKING_SOURCE_ID` so these leads are attributed correctly.

### "Edits to admin dashboard to complement the CRM"

The complementary edit is the **sender**: the booking `POST /api/book` route (and
the admin manual-booking route) should fire the ingest call above after a
successful reservation. You said you'll drive ingestion via **n8n** — so the
cleanest split is: booking DB insert → n8n trigger → `POST /api/ingest/reservation`.
I can either add the fetch directly to the booking routes **or** hand you the exact
n8n HTTP-node config. Tell me which.

---

## 2. Phase 5 — Channel ingestion keys (you'll provide later)

All env var names already exist in `.env.example`. For each channel I need:

**Facebook / Instagram (your "developers Facebook app"):**
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- `FACEBOOK_PAGE_ACCESS_TOKEN` (long-lived Page token, `pages_messaging` +
  `pages_manage_metadata` + `instagram_manage_messages` scopes)
- `FACEBOOK_WEBHOOK_VERIFY_TOKEN` (a string you invent; must match the webhook config)
- `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- The Page must be subscribed to `messages`, `messaging_postbacks`, `feed` (comments).

**WhatsApp Business Cloud API:**
- `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`

**n8n:**
- The n8n webhook URL(s) you want the CRM to call, and any signing secret. If n8n
  calls the CRM instead, it just needs `CRM_INGEST_API_KEY` (already defined).

> **Decision needed (D4):** Do webhooks land **on the CRM** (I build
> `/api/webhooks/meta` + `/api/webhooks/whatsapp`) or **on n8n** which normalizes and
> calls the CRM ingest? Recommend n8n → CRM ingest to keep secrets in one place.

---

## 3. Phase 6 — Report creator, bulk import, Sheets, settings

### 3a. Report creator (role-based) — **blocked on auth (see §4)**
Role matrix you specified:
- **Admin** → create all report types
- **Auditor** → create all report types
- **Moderator** → create **Moderator** and **Follow-up** reports only

The CRM now resolves real Supabase Auth sessions through `crm_users` for the shell
and write actors. Report creation still needs its own server actions and capability
checks before "who submitted this report" is trustworthy end-to-end.

### 3b. Bulk import (Excel / Google Sheets) — buildable now
Plan: upload `.xlsx`/`.csv` → parse → **column-mapping/reorder review step** (drag to
map each sheet column to a CRM lead field, since column order varies) → validate →
insert into `leads`. Writes go through the service role.
> **Decision needed (D5):** Confirm the target table is `leads` and give me the
> canonical column set your sheets use (I'll pre-seed the mapping suggestions).

### 3c. Google Sheets mirror — infrastructure only (you'll add creds later)
Env already scaffolded: `CRM_GOOGLE_SHEETS_SPREADSHEET_ID`,
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`. I'll build the write-through
mirror service + a toggle; it stays dormant until the service account is shared on
the target spreadsheet.

### 3d. Editable settings — needs write access + scope
`/settings` currently renders `crm_settings` read-only with Editable/Locked badges.
To make it write:
> **Decision needed (D6):** Which settings keys are user-editable (vs locked)? Once
> you confirm, I add PATCH actions that write `crm_settings` via the service role.
> Everything is technically writable already (service role); the question is policy.

---

## 4. Auth — the cross-cutting blocker

Everything role-based (report creator, edit permissions, "who marked this") depends
on real sign-in. The shell and Prompt 1 lead/queue mutations resolve real
Supabase Auth users through `crm_users`; remaining report/settings actions still
need the same enforcement as they are implemented.

- Admin account to add: **doitrous@hotmail.com** (already in booking auth; you said
  it's on Supabase). I will add it to the CRM's `crm_users` as **admin**.
> **Decision needed (D7):** Auth mechanism — Supabase Auth (email+password) on the
> **CRM** project? If yes I'll wire `@supabase/ssr` sessions, map `auth.users` →
> `crm_users.role`, and replace the hardcoded user. Confirm and I'll add the admin
> account + set the password (you gave `0000` — recommend resetting after first login).

---

## 5. Arabic UI toggle (full RTL ⇄ LTR) — buildable now, self-contained

Plan (CRM-native, no dependency on the booking i18n): a `LocaleProvider` +
`dir="rtl"/"ltr"` on `<html>`, a header toggle that persists the choice (cookie), and
an `ar`/`en` dictionary covering all CRM strings. Turning on Arabic flips the whole
shell to RTL; turning it off reverts to LTR. No Supabase data needed.
> This one has no blocking decision — I can build it next on your go-ahead.

---

## 6. Consolidated asks (quick-answer list)

- **D1** Approve federated read (booking service key in CRM `.env.local`)? [recommend yes]
- **D2** Every reservation → lead, or only new patients?
- **D3** OK to add `website_booking` to `leads.platform` + a "Website booking" `lead_sources` row?
- **D4** Channel webhooks on CRM or on n8n? [recommend n8n → CRM ingest]
- **D5** Bulk-import target = `leads`? Share a sample sheet's columns.
- **D6** Which `crm_settings` keys are editable vs locked?
- **D7** Auth = Supabase Auth on the CRM project? Confirm adding doitrous@hotmail.com as admin.
- **Order** Which do you want first: Auth, Arabic toggle, Bulk import, or the n8n ingest sender?
