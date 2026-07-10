# Aspects Clinica CRM

Production CRM for Aspects Clinica lead management, Messenger/Instagram/WhatsApp
conversations, follow-up, booking, financial operations, audit, and reporting.

## Stack

- Next.js 15 App Router, React 19, TypeScript
- Tailwind CSS with light/dark semantic tokens and English/Arabic direction support
- Supabase Postgres/Auth for CRM data
- The Aspects booking/Admin Supabase project for canonical doctors, services,
  schedules, slots, reservations, and calendar data

## Data Sources

Production defaults to the live Supabase provider. The in-memory provider is an
explicit development/test fixture only; `CRM_DATA_SOURCE=mock` is rejected when
`NODE_ENV=production`.

Server-only credentials stay in server modules. Browser code receives only the
public CRM Supabase URL and anonymous key.

## Local Commands

```bash
npm install
npm run dev       # http://localhost:3100
npm run lint
npm run test
npx tsc --noEmit
npm run build
```

See `.env.example`, `PERFORMANCE_AUDIT.md`,
`CRM_IMPLEMENTATION_CHECKLIST.md`, and `docs/INTEGRATIONS.md` for deployment and
verification details.
