# Aspects Clinica CRM

CRM for a dermatology / aesthetic / laser clinic — lead management, conversations
(Messenger / Instagram / WhatsApp), booking sync, follow-up, escalation, duplicate
review, auditing and reporting.

Visual language is ported from the design prototype (`Clinic Prototype (standalone).html`):
soft clinic surfaces, Playfair Display headings, clinic-blue (`#2f6fed`) primary,
warm terracotta/cream accents. **Light mode is the default and only supported mode
today** (dark-mode groundwork is in place, off by default).

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS** — design tokens extracted verbatim from the prototype live in
  `tailwind.config.ts` (single source of truth for colour/spacing/typography).
- **Supabase** (Postgres + Auth + RLS + Realtime) — **connected and live.** The
  project already hosts the full CRM schema (55 tables); see `supabase/README.md`.

## Data layer (important)

The app runs on the **live Supabase schema** through an adapter
(`lib/data/supabase.ts`) that maps real rows to the view models in `lib/types.ts`.
An in-memory **mock/seed** layer (`lib/data/mock.ts`) implements the same async
contract (`lib/data/contracts.ts`) for offline development.

`lib/data/index.ts` selects the provider from **`CRM_DATA_SOURCE`**
(`supabase` | `mock`); all query functions are async and identical across both.

```
lib/data/
  contracts.ts   # DataProvider interface + LeadFilters / DashboardMetrics
  supabase.ts    # live adapter (service-role client, server-only)
  mock.ts        # seed-backed provider (same contract)
  index.ts       # router: picks provider by CRM_DATA_SOURCE
lib/supabase/
  server.ts      # service-role client (server-only)
```

## Run

```bash
npm install
npm run dev          # http://localhost:3100
```

All visible dates render as **`Jun 06, 2026`** via `lib/format.ts` — use those
helpers, never `toLocaleDateString`.

## Layout

```
app/
  (crm)/               # authenticated CRM shell (sidebar + topbar)
    dashboard/         # moderator KPI + pipeline dashboard (clickable → filtered leads)
    leads/             # leads list + filters
    leads/[id]/        # individual lead page (9 tabs)
    database/ follow-up/ duplicates/ escalations/
    calendar/ auditor/ reports/ settings/   # stubs → built in later phases
components/
  shell/               # Sidebar, Topbar
  leads/               # LeadsTable, LeadsToolbar
  lead/                # LeadDetail (tabs), MessageThread, NotesTab
  ui/                  # Badge, Card, EmptyState, ComingSoon
lib/
  types.ts             # domain view model (UI shapes)
  supabase/server.ts   # service-role client (server-only)
  data/                # provider router + live Supabase adapter + mock
  badges.ts format.ts nav.ts cn.ts
supabase/README.md     # live schema is source of truth (55 tables)
supabase/archive/      # obsolete invented schema draft — do NOT apply
```

## Roadmap

- **P1 ✓** scaffold, design system, app shell, live Supabase data layer, auth-role-aware nav
- **P2 ◐** dashboard ✓, leads list ✓, lead page + 9 tabs ✓, notes ✓, timeline ✓ (all on live data) · database-leads tab pending
- **P3** follow-up, duplicates merge, escalations, auditor dashboard (prev-day)
- **P4** booking integration + live double-booking prevention
- **P5** Facebook / Instagram / WhatsApp ingestion + Ingestion/Logs tabs
- **P6** reports, report creator, bulk import, Sheets mirror, settings, i18n/RTL

See `.env.example` for every integration credential the later phases will need.
