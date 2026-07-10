# Performance Audit

Date: 2026-07-10  
Project: Aspects Clinica CRM only

## Measurements

Measured against the configured Aspects Clinica CRM Supabase project from this workspace. The live CRM database currently has 26 leads, so these numbers verify code paths and remote latency, not 20,000-row production volume.

| Probe | Before measurement | After measurement | Notes |
|---|---:|---:|---|
| Production build | 17.98s | 18.38s | `npm run build`; both passed. |
| Unit tests | 178/178 pass | 178/178 pass | `npm run test`; sandbox required escalation because `tsx` opens an IPC pipe. |
| Lead count query | Not measured before changes | 3647ms | Direct Supabase count, 26 leads. |
| Lead list page, 30 rows | Not measured before changes | 2534ms | Direct Supabase query with `range(0,29)`, count exact. |
| Phone-like search, 30 rows | Not measured before changes | 2446ms | Direct Supabase `ILIKE` OR query, 20 matches. |
| New drawer shell round 1 | Not applicable before shell split | 2359ms | Lead row + active tags + active lost reasons. |
| New drawer shell round 2 | Not applicable before shell split | 711ms | Assigned tags + optional moderator/lost reason. |

User-reported production symptom: lead drawer opening and tab switching commonly took about 3-5 seconds. I did not independently measure the old browser interaction before changing it.

## Slow Paths

| Screen/action | Current query path before this phase | Number of queries before | Data volume loaded before | Identified bottleneck | Fix implemented | Before measurement | After measurement | Remaining concern |
|---|---|---:|---|---|---|---:|---:|---|
| Open lead drawer | Intercepted route called `loadLeadDetail()` before rendering `LeadModal` | Roughly 40+ queries in worst case, including nested `getLead()` calls | Lead row, all messages, all comments, attribution, full timeline, bookings, escalations, duplicate groups, all leads for duplicate member names, financial graph, booking catalog, tags, lost reasons | Drawer shell blocked by every heavy/fragile tab | `loadLeadDetail()` now returns a shell only; heavy tabs load through `/api/leads/[id]/tab` on demand | User reported 3-5s; not independently measured | Shell direct DB probe: 2359ms + 711ms remote query time | Remote Supabase latency is high; shell still needs live browser timing behind auth. |
| Switch drawer tabs | All tab data was already part of one full server render; mutation revalidation could reload the whole drawer | No per-tab boundary | Heavy histories always resident in drawer payload | No lazy boundary or tab cache | Client tab cache keyed by `leadId:tab`; uncached tabs fetch only their tab JSON | User reported 3-5s; not independently measured | Cached tab switch is in-memory; uncached tab is one API request | Browser smoke still needed. |
| Lead list `/leads` | `getLeads(filters)` selected every matching row and then tags/follow-ups for all returned leads | 1 broad lead query + lookup/tag/follow-up queries | All matching leads in browser | No server pagination | `getLeadsPage()` uses `range()` with 30 rows and exact count | Not measured before | 30-row direct query 2534ms on 26-lead DB | Offset pagination is acceptable now; cursor pagination should be considered at much larger scale. |
| Database lead list `/database` | Same as `/leads` | Same as `/leads` | All matching leads | Same | Same 30-row server page implementation | Not measured before | Same query class as `/leads` | Same. |
| Calendar booking-to-lead map | Calendar called `getLeads()` only to map `bookingAppointmentId` | 1 broad all-leads query plus tag/follow-up work | Up to every lead | Full-table CRM fetch unrelated to calendar rendering | Removed full lead fetch; uses `syncReservationsToLeads()` map | Not measured before | No CRM full-lead query in this path | Reservation sync itself can still be heavy for very large booking ranges. |
| Duplicate members in drawer Log | `loadLeadDetail()` called `getLeads()` and searched in memory | Full lead list | Every lead | Full-table read to name a few duplicate members | Log tab resolves only duplicate member IDs with targeted `getLead()` calls | Not measured before | Deferred until Log tab | Could be optimized further with a compact batch lookup. |
| Messages tab | `messagesFor()` loaded full conversation and attachments during drawer open | 2-4 queries after lead UID resolution | Full conversation history | Large histories blocked opening | Deferred to Conversation tab | Not measured before | Not measured after | Needs pagination/incremental loading for very large conversations; current fix removes it from shell only. |
| Comments tab | `commentsFor()` loaded all comments and attachments during drawer open | 2-3 queries after lead UID resolution | Full comment history | Large histories blocked opening | Deferred to Comments tab | Not measured before | Not measured after | Needs pagination for very large comment histories. |
| Payments tab | `leadFinancials()` loaded full financial graph during drawer open | 10+ queries when financial record exists | Payments, approvals, consumables, costs, audit | Financial graph blocked opening and could throw during unrelated status/tag writes | Deferred to Payments tab; successful financial actions refresh only Payments tab cache | Not measured before | Not measured after | Browser smoke/payment persistence still needed. |
| Live booking tab | `bookingCatalog()` and `bookingsFor()` loaded during drawer open | Booking catalog 5 queries + booking lookup | Booking catalog whether tab used or not | Separate booking source blocked lead opening and unrelated writes | Deferred to Booking tab; action errors returned as form state | Not measured before | Not measured after | Need live slot-load smoke in authenticated browser. |
| Status/tag/note actions | Server actions revalidated broad CRM paths after writes | Re-rendered expensive Server Components | Could reload full drawer/page | Small mutation coupled to heavy render, causing production digest errors when any reloaded dependency failed | Drawer shell is lightweight; action boundaries return useful errors instead of rethrowing normal `Error`s | Production digest reported by user | Build/tests pass | Need deployed log confirmation for exact old digest source. |
| Notes save | Update did not verify returned row | 1 update + audit + timeline | N/A | UI could report success after an update path that did not prove a row changed | Update now requests `.select("id").single()` and sets `updated_at` | Not measured | Not measured | Live save/refresh smoke still needed. |
| Search | Broad `ILIKE` OR over lead id, MRN, name, phone, chat link, platform id | 1 query | Previously all matches; now 30 rows | Leading wildcard cannot use existing btree indexes | Added `pg_trgm` GIN indexes and server paging | Not measured before | 2446ms on current DB before migration is applied | Apply migration `0011`; re-run explain/analyze in Supabase after migration. |

## Query Count Changes

Approximate code-level counts:

| Path | Before | After |
|---|---:|---:|
| Drawer shell open | 40+ possible queries before first paint | 2 remote rounds for shell/reference data; heavy tab queries deferred |
| Lead list page | All matching leads + tag/follow-up joins for all rows | 30 lead rows + tag/follow-up joins for those 30 |
| Calendar lead mapping | Full `getLeads()` path | 0 broad lead-list queries |
| Log duplicate member lookup | Full `getLeads()` path | Targeted duplicate member lookups only when Log opens |

## Indexes Added

Migration: `supabase/migrations/0011_crm_performance_indexes.sql`

Added:

- `pg_trgm`
- `leads_updated_at_idx`
- `leads_status_updated_at_idx`
- `leads_platform_updated_at_idx`
- `leads_source_updated_at_idx`
- `leads_doctor_updated_at_idx`
- `leads_unread_updated_at_idx`
- `leads_reply_overdue_updated_at_idx`
- `leads_escalated_updated_at_idx`
- Trigram GIN indexes for `lead_id`, `mrn`, `name`, `normalized_phone`, `phone_number`, `platform_id`, `chat_link`
- `lead_timeline_events_lead_event_at_idx`
- `audit_logs_entity_created_at_idx`
- `lead_follow_up_stages_open_idx`

Write impact: the lead table now has more indexes, especially GIN trigram indexes. This is justified by the CRM's read-heavy search/list workflow, but insert/update performance should be rechecked after migration on production-sized data.

## Root Causes Found

- Status production error: small status actions revalidated broad paths and could re-render the full eager drawer, including unrelated booking/financial/history reads. Normal database/action errors also escaped `toState()` and became production Server Component digests.
- Tag production error: same mutation/render coupling and error-boundary issue as status changes.
- Notes failure: save path did not prove the update returned a row before success, and the drawer relied on local state for the visible value until a full reload.
- Payment client exception: the Payments tab did not refresh its financial graph after successful server actions, leaving nested client state and server state out of sync; ordinary server errors could also bubble through the action boundary depending on source.
- Live booking server exception: booking action boundary only handled `BookingError`; SDK/env/fetch failures escaped as server exceptions.

These are code-path root causes from inspection and local verification. I could not access production server logs in this workspace, so I did not confirm an individual production digest ID.

## Acceptance Coverage

Verified:

- Production build passes.
- Unit tests pass: 178/178.
- Lead lists are server-paginated in code (`range()` with 30 rows).
- Search remains database-side and no longer requires downloading all leads.
- Drawer shell no longer fetches messages/comments/payments/booking/log before render.
- Status changes require confirmation before mutation.
- Notes update waits for a returned Supabase row before success.
- Payment mutations trigger Payments-tab refresh only.
- Live booking slot action returns error state instead of a server-error page for non-`BookingError` failures.

Not fully verified due authenticated browser/session limitations in this run:

- End-to-end drawer click/tabs/close/reopen/refresh workflow.
- Status/tag/note/payment persistence by browser refresh.
- Financial totals after payment by browser refresh.
- Live booking slot load in browser.
- 20,000-row live benchmark. The production CRM currently measured at 26 leads; migration/index behavior should be re-tested after applying `0011` to a staging-sized dataset.
