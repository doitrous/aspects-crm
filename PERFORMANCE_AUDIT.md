# Performance Audit

Date: 2026-07-10  
Project: Aspects Clinica CRM only

## Final Verification Pass — 2026-07-11

Live read-only probes used the configured Aspects CRM Supabase project. It held
27 leads during this pass; no 20,000-row production-sized database was available,
so no 20,000-row latency is claimed.

| Probe | Runs (ms) | Median | Result |
|---|---|---:|---|
| Server lead page (`range(0,29)`, exact count) | 832.5, 157.4, 119.9, 114.4, 118.8 | 119.9 ms | 27 rows total, at most 30 returned |
| Server search across ID/MRN/name/phone/platform/chat link | 144.8, 121.4, 119.7, 119.8, 108.1 | 119.8 ms | 20 matches, at most 30 returned |
| Six pipeline counts in parallel | 326.0, 501.6, 1103.3, 521.9, 328.8 | 501.6 ms | Counts computed in Postgres; no status universe downloaded |
| Drawer lead-row shell query | 251.4, 247.9, 110.9, 108.9, 122.0 | 122.0 ms | One selected lead row |
| Latest-message query (`limit(100)`) | 98.7, 229.0, 107.8, 102.0, 110.4 | 107.8 ms | Bounded per-lead history |

Measured production drawer interaction was not accepted as evidence: the
existing Chrome session expired during the intercepted-route navigation, so the
drawer did not complete an authenticated render.

Final query changes:

- `pipelineCounts()` changed from downloading every `leads.status` row to six
  parallel `count exact, head` queries.
- Follow-Up and Post-Op queues now use genuine 30-row server pagination and only
  query concrete follow-up stages for the current page's lead IDs.
- Messenger/WhatsApp filtering now happens in SQL. Message and comment reads are
  bounded to the latest 100 rows; Log timeline reads are bounded to 200 rows.
- Drawer-tab lead existence is now one compact lookup instead of `getLead()`,
  which previously loaded global users, lost reasons, duplicate flags, tags and
  follow-ups before the tab-specific query.
- Duplicate-group member display changed from one `getLead()` call per member to
  one batched lead lookup.

Remaining performance concern: older message/comment/log pages do not yet expose
an incremental “load older” control. Reads are now bounded and cannot preload
thousands, but complete-history navigation is PARTIAL rather than PASS.

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
| Phase 1 production build | 18.38s | 19.63s | `npm run build`; passed after Messenger/WhatsApp/stage/follow-up/payment-action changes. |
| Phase 1 unit tests | 178/178 pass | 178/178 pass | `npm run test`; first sandbox run hit IPC `EPERM`, escalated rerun passed. |
| Phase 2 production build | 19.63s | 18.44s | `npm run build`; passed after Booking UI, Website Reservations rename, Bulk Import, Audit Logs, Settings structure, and escalation-reason changes. |
| Phase 2 unit tests | 178/178 pass from previous phase | Blocked in current run | `npm run test` hit `tsx` IPC `EPERM`; required escalated rerun was rejected by environment usage limit, so no current test result was produced. |

User-reported production symptom: lead drawer opening and tab switching commonly took about 3-5 seconds. I did not independently measure the old browser interaction before changing it.

## Phase 1 Follow-Up

| Screen/action | Current query path | Number of queries | Data volume loaded | Identified bottleneck | Fix | Before measurement | After measurement | Remaining concern |
|---|---|---:|---|---|---|---:|---:|---|
| Messenger tab | `/api/leads/[id]/tab?tab=Messenger` -> `messagesFor(id, ["facebook", "instagram"])` | Lead existence lookup + message query + attachment/reaction queries when needed | Only FB Messenger/Instagram DM history for the selected lead | Old `Conversation` label mixed WhatsApp into the same communication tab | Renamed tab to Messenger and scoped payload to Facebook/Instagram channels | Not separately measured | Build/test verified; no browser timing captured | Conversation pagination is still needed for very large histories. |
| WhatsApp tab | `/api/leads/[id]/tab?tab=WhatsApp` -> `messagesFor(id, ["whatsapp"])` plus server-only config check | Lead lookup + message query + attachment/reaction queries when needed | Only WhatsApp history for the selected lead | No real tab/integration path existed; credentials absent could have caused fake or crashing UI | Added honest Not Configured state and secure server ingest path at `/api/crm/ingest/whatsapp` | Not applicable | Build/test verified; no live credentials available | Needs live WhatsApp/n8n credential smoke and send-state verification. |
| Follow-Up tab | `/api/leads/[id]/tab?tab=Follow-Up` -> `loadFollowUpPlan()` | Lead lookup + concrete plan rows + user names; creates snapshot rows only if lead is in follow-up/post-op and has none | All configured concrete steps for that selected lead, not all leads | Old tab showed one active stage only; settings changes could not express arbitrary plans | Added configurable plan settings fields and concrete snapshot display/actions | Not measured | Build/test verified | Need live browser persistence smoke; very large per-lead plans are unlikely but still unpaginated. |
| Dedicated stage pages | `/leads`, `/qualified`, `/follow-up`, `/post-op`, `/database` | One server-paginated list/queue request per page | 30 rows for list pages; follow-up queue rows for the selected stage | Primary-stage pages were not exclusive; Qualified/Post-Op pages missing | New Leads locked to `new`; Qualified = `qualified` + `booked`; Follow-Up/Post-Op split; Database renamed unified view | Not measured | Build/test verified | Follow-up queue itself should receive server pagination if it grows large. |
| Tag settings | Settings actions -> `lead_tags` | One targeted insert/update + audit log | One tag definition per action | Global tag definitions could not be ordered; unexpected settings errors could become RSC digests | Added `display_order`, color/name/active controls, server error-state handling | Not measured | Build/test verified | Needs live Admin/Auditor/Moderator browser permission smoke. |

## Phase 2 Booking / Import / Audit / Settings

| Screen/action | Current query path | Number of queries | Data volume loaded | Identified bottleneck | Fix | Before measurement | After measurement | Remaining concern |
|---|---|---:|---|---|---|---:|---:|---|
| Booking tab | Lazy drawer tab -> `bookingCatalog()`, `availableBookingSlots()`, `createLeadBookingAction()` | Catalog lookup plus live slot query only when Booking tab is opened | Specialty/doctor/service/branch catalog and selected-date slots only | Old CRM booking UI was functional but did not match the supplied public booking flow closely enough | Rebuilt Booking tab as a stepped public-booking-style flow: specialty/doctor, branch/service, date, live slot, patient info, review/confirm | Not browser-measured | Production build passes | Needs authenticated live-slot booking smoke; browser timing not captured. |
| Website Reservations | `/reservations` -> booking DB reservations + `syncReservationsToLeads()` | Reservation page read plus idempotent CRM link/create sync | Booking rows in selected page scope, linked CRM lead IDs | Page name and unread semantics still used Patient Reservations wording | Renamed to Website Reservations and treats `reserved` as new/unread awaiting confirmation | Not measured | Production build passes | Needs live public reservation event smoke and unread counter verification. |
| Bulk Import | Client parses CSV/TSV/XLSX, then confirmed rows -> `importFinancialRows()` | No DB writes until confirm; per valid row resolves lead by ID/MRN/phone, may create canonical lead, then quote/payment actions | Uploaded preview rows stay client-side; only valid rows are submitted | CSV-only importer and match-only server path could not import canonical leads from safe Name+Phone rows | Added XLSX parsing, drag/drop, explicit six-step flow, manual mapping, validation, duplicate warnings, canonical lead/finance writes, and import audit log | Not measured | Production build passes; tests blocked | Needs browser file upload smoke for CSV and XLSX; no current unit test run. |
| Audit Logs | `/audit-logs` -> `listActivity()` | One `audit_logs` query plus actor lookup | Latest 500 filtered audit rows | Old global viewer was still named Activity and lacked role/lead/date filters | Added Audit Logs route/nav with Admin/Auditor guard, filters, actor role, lead/entity/action/date display | Not measured | Production build passes | Needs role smoke: Admin/Auditor visible, Moderator forbidden. |
| Settings structure | `/settings` -> existing settings readers + integration booleans | Parallel reads for real settings tables and booking snapshot | Only settings/config rows | Settings tabs did not match requested structure and escalation reasons had no controlled list | Added requested structure with real editors where backed by tables, read-only operational panels where rules are hardcoded, and new escalation-reason table/editor | Not measured | Production build passes | Migration `0013` must be applied for persisted escalation reasons; live persistence smoke needed. |

## Indexes Added In Phase 1

Migration: `supabase/migrations/0012_crm_whatsapp_followup_settings.sql`

Added:

- `lead_tags.display_order`
- `lead_tags_active_order_idx`
- follow-up setting applicability/version columns: `anchor`, `applicable_status`, `applicable_tag_id`, `plan_version`
- `crm_followup_workflow_active_order_idx`
- `crm_followup_workflow_applicability_idx`
- concrete follow-up snapshot columns: `template_stage_id`, `template_version`, `step_name`, `anchor`, `completed_by`, `snoozed_at`, `snoozed_by`
- `lead_follow_up_stages_plan_idx`
- `lead_follow_up_stages_open_due_idx`

Write impact: tag and follow-up writes gain small btree indexes. This is justified by repeated operational reads in Settings, stage queues, and lead drawer follow-up tabs.

## Schema Added In Phase 2

Migration: `supabase/migrations/0013_crm_escalation_reasons.sql`

Added:

- `crm_escalation_reasons`
- `crm_escalation_reasons_label_key`
- `crm_escalation_reasons_active_order_idx`

Write impact: tiny controlled-list table for settings. It does not add write overhead to lead mutations; the lead drawer reads active reasons in the shell so escalation workflows consume Settings-defined options.

## Slow Paths

### 2026-07-11 Live Browser Addendum

| Screen/action | Current query path | Query/round trips | Data loaded | Bottleneck | Fix | Before measurement | After measurement | Remaining concern |
|---|---|---:|---|---|---|---:|---:|---|
| Cached drawer tab | Client `tabCache` → `LeadDetail` | 0 remote requests when loaded | Cached tab payload only | Cached branch re-applied payload and mutated `loadedTabs` every render | Check `loadedTabs` before applying cache | Reproduced repeated maximum-update-depth errors; user reported 3–5s/stuck controls | No new render-loop error in subsequent browser workflows | Cache is per browser session, not shared across devices |
| Booking availability | Booking Server Action → booking schedules/appointments/blocks in parallel | 1 action; 3 availability queries in parallel after settings/service reads | One doctor/branch/date | Shared transition and no timeout made a slow booking source look infinite | Dedicated pending state, `try/finally`, 20s timeout | User reported indefinite loader | Real slots rendered within the 5-second observation window | Booking Supabase latency remains material |
| Quoted price | `saveQuote` → financial/audit/timeline, then targeted Payments refetch | Mutation plus one background tab request | One lead financial graph | Broad `revalidatePath('/leads')` kept Server Action pending through current drawer rerender | Removed broad lead revalidation; callback identity stabilized | Dev log around earlier flow: POST 2.650s + Payments GET 2.833s, visually about 5.5s | Later transaction path: POST 1.540s; button released before background Payments GET 2.094s completed | Remote DB graph still takes about 2s to refresh |
| Status change | Actor/lead reads → lead update → audit/timeline | Three remote rounds after parallelization | One lead plus two append-only log rows | Actor and lead reads were sequential; audit and timeline inserts were sequential; six broad route revalidations followed | Parallel actor/lead and audit/timeline; exact list-page invalidation | Browser New→Qualified flow before final parallelization: POST 8.109s, modal closed after roughly 6s observation | Not re-measured after final parallelization; no invented number reported | Re-measure in production after deploy |
| Notes | Actor/lead reads → update → audit/timeline | Three remote rounds after parallelization | One note field and two log rows | Sequential identity/read/log calls and stale parent state | Parallel safe reads/log writes; update parent note state immediately | Previously visible only after drawer reopen | Saved note survived tab switch and refresh; no precise stopwatch measurement taken | Remote persistence latency remains |
| Escalation Send back | Escalation/lead update → unread event → timeline/audit | Targeted mutation path | One escalation/lead and log rows | Broad revalidation and void action left controls pending without useful result | Explicit action state/href and targeted page invalidation | User reported lag/stuck | Browser action completed and success/link appeared within 2.2s wait | Completely Resolved uses same action boundary but was not destructively retested |

| Screen/action | Current query path before this phase | Number of queries before | Data volume loaded before | Identified bottleneck | Fix implemented | Before measurement | After measurement | Remaining concern |
|---|---|---:|---|---|---|---:|---:|---|
| Open lead drawer | Intercepted route called `loadLeadDetail()` before rendering `LeadModal` | Roughly 40+ queries in worst case, including nested `getLead()` calls | Lead row, all messages, all comments, attribution, full timeline, bookings, escalations, duplicate groups, all leads for duplicate member names, financial graph, booking catalog, tags, lost reasons | Drawer shell blocked by every heavy/fragile tab | `loadLeadDetail()` now returns a shell only; heavy tabs load through `/api/leads/[id]/tab` on demand | User reported 3-5s; not independently measured | Shell direct DB probe: 2359ms + 711ms remote query time | Remote Supabase latency is high; shell still needs live browser timing behind auth. |
| Switch drawer tabs | All tab data was already part of one full server render; mutation revalidation could reload the whole drawer | No per-tab boundary | Heavy histories always resident in drawer payload | No lazy boundary or tab cache | Client tab cache keyed by `leadId:tab`; uncached tabs fetch only their tab JSON | User reported 3-5s; not independently measured | Cached tab switch is in-memory; uncached tab is one API request | Browser smoke still needed. |
| Lead list `/leads` | `getLeads(filters)` selected every matching row and then tags/follow-ups for all returned leads | 1 broad lead query + lookup/tag/follow-up queries | All matching leads in browser | No server pagination | `getLeadsPage()` uses `range()` with 30 rows and exact count | Not measured before | 30-row direct query 2534ms on 26-lead DB | Offset pagination is acceptable now; cursor pagination should be considered at much larger scale. |
| Database lead list `/database` | Same as `/leads` | Same as `/leads` | All matching leads | Same | Same 30-row server page implementation | Not measured before | Same query class as `/leads` | Same. |
| Calendar booking-to-lead map | Calendar called `getLeads()` only to map `bookingAppointmentId` | 1 broad all-leads query plus tag/follow-up work | Up to every lead | Full-table CRM fetch unrelated to calendar rendering | Removed full lead fetch; uses `syncReservationsToLeads()` map | Not measured before | No CRM full-lead query in this path | Reservation sync itself can still be heavy for very large booking ranges. |
| Duplicate members in drawer Log | `loadLeadDetail()` called `getLeads()` and searched in memory | Full lead list | Every lead | Full-table read to name a few duplicate members | Log tab resolves only duplicate member IDs with targeted `getLead()` calls | Not measured before | Deferred until Log tab | Could be optimized further with a compact batch lookup. |
| Messages tab | `messagesFor()` loaded full conversation and attachments during drawer open | 2-4 queries after lead UID resolution | Full conversation history | Large histories blocked opening | Deferred to Messenger/WhatsApp tabs | Not measured before | Not measured after | Needs pagination/incremental loading for very large conversations; current fix removes it from shell only. |
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
- Payment client exception: the Payments tab imported `IDLE` from `app/(crm)/leads/financial-actions.ts`, a `"use server"` module exporting a non-function object. The dev server logged Next's server-action validation error: `"A \"use server\" file can only export async functions, found object."` Successful financial actions also needed per-tab refresh instead of relying on broad drawer revalidation.
- Live booking server exception: booking action boundary only handled `BookingError`; SDK/env/fetch failures escaped as server exceptions.

These are code-path root causes from inspection and local verification. I could not access production server logs in this workspace, so I did not confirm an individual production digest ID.

## Acceptance Coverage

Verified:

- Production build passes.
- Unit tests passed in the previous phase: 178/178. Current phase test run is blocked by the environment usage-limit rejection after a sandbox IPC failure.
- Lead lists are server-paginated in code (`range()` with 30 rows).
- Search remains database-side and no longer requires downloading all leads.
- Drawer shell no longer fetches messages/comments/payments/booking/log before render.
- Status changes require confirmation before mutation.
- Notes update waits for a returned Supabase row before success.
- Payment mutations trigger Payments-tab refresh only.
- Live booking slot action returns error state instead of a server-error page for non-`BookingError` failures.
- Booking tab uses the public-booking-style stepped UI while still reading live booking catalog/slot source.
- Bulk Import does not write before explicit confirmation and routes valid rows into canonical lead/financial mutations.
- Audit Logs route builds and is Admin/Auditor gated in code.
- Settings route builds with the full requested structure and real persisted editors for supported sections.

Not fully verified due authenticated browser/session limitations in this run:

- End-to-end drawer click/tabs/close/reopen/refresh workflow.
- Status/tag/note/payment persistence by browser refresh.
- Financial totals after payment by browser refresh.
- Live booking slot load in browser.
- 20,000-row live benchmark. The production CRM currently measured at 26 leads; migration/index behavior should be re-tested after applying `0011` to a staging-sized dataset.
