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
npm run typecheck
npm run build
```

## GitHub and MCP access

The canonical repository is
[`omary98/aspects-crm`](https://github.com/omary98/aspects-crm). Use its HTTPS
remote and authenticate through GitHub CLI:

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
git remote set-url origin https://github.com/omary98/aspects-crm.git
git push -u origin HEAD
```

`gh auth status` must pass before pushing. The workflow in
`.github/workflows/ci.yml` runs typechecking, linting, and the test suite for
pull requests and pushes to `main`.

The tracked `.codex/config.toml` exposes both current n8n MCP instances without
committing credentials. Set `N8N_MCP_TOKEN` and `N8NSQ_MCP_TOKEN` locally,
trust the repository, restart Codex, and verify with `/mcp` or
`codex mcp list`. `n8n` is `n8neurocure.doitrous.com`; `n8n_sq` is
`n8nsq.doitrous.com`.

## Production deployment

1. Configure the mandatory CRM Supabase variables documented in `.env.example`.
2. Apply unapplied CRM migrations in `supabase/migrations/` in numeric order.
   Migration `0026_dashboard_metrics.sql` is additive and should be applied
   before or alongside this release; the application retains a slower fallback
   during a rolling deployment.
3. Run `npm ci`, `npm run build`, then `npm run start` (port 3100).
4. Schedule `POST /api/cron/overdue-emails` with `Authorization: Bearer
   <CRON_SECRET>`. Do not place the secret in a URL for new schedulers.
5. Apply `0043_lead_trash_retention.sql`, then its function-only forward repair
   `0044_repair_lead_trash_functions_and_metrics.sql`. After both are applied, schedule
   `POST /api/cron/purge-lead-trash` daily with the same authorization header.
   This permanently removes items after their exact 30-day retention deadline.
   Opening Settings → Trash also runs the same idempotent purge.

The booking integration and messaging/email integrations degrade independently
when they are not configured; CRM authentication and the CRM service-role key
are mandatory.

The live origin is `https://crm.aspectsclinica.net`. The deployment provider,
GitHub installation, automatic-deploy branch, backup owner, and rollback
command still require confirmation; do not add a provider-specific deploy job
or change production until those facts are recorded.

See `.env.example`, `PERFORMANCE_AUDIT.md`,
`CRM_IMPLEMENTATION_CHECKLIST.md`, and `docs/INTEGRATIONS.md` for deployment and
verification details.
