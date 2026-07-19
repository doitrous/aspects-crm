import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(
  new URL("../../supabase/migrations/0044_repair_lead_trash_functions_and_metrics.sql", import.meta.url),
  "utf8",
);
const stagePage = readFileSync(new URL("../../components/leads/StageLeadsPage.tsx", import.meta.url), "utf8");

test("trash restore and purge qualify lead_id references that collide with output names", () => {
  assert.equal(migration.match(/select trashed_lead\.lead_id into human_lead_id/g)?.length, 2);
  assert.doesNotMatch(migration, /select\s+lead_id\s+into human_lead_id/i);
  assert.match(migration, /ingest_log\.lead_id = target_lead_id/);
  assert.match(migration, /email_log\.lead_id = target_lead_id/);
  assert.match(migration, /red_flag\.lead_id = target_lead_id/);
  assert.match(migration, /legacy_followup\.lead_id = target_lead_id/);
  assert.equal(migration.match(/returning lead\.lead_id/g)?.length, 2);
});

test("dashboard metrics preserve active operational lead filters", () => {
  assert.match(migration, /lead\.merged_into_lead_id is null/);
  assert.match(migration, /lead\.deleted_at is null/);
  assert.match(migration, /coalesce\(lead\.metadata->>'database_only', 'false'\) <> 'true'/);
  assert.match(migration, /lead\.metadata->>'record_source' is distinct from 'database'/);
  assert.match(migration, /flag\.status not in \('linked', 'merged', 'dismissed'\)/);
  assert.match(stagePage, /excludeDatabaseOnly: true/);
});

test("repaired functions remain service-role only", () => {
  for (const fn of ["crm_restore_trashed_lead", "crm_purge_trashed_lead", "crm_dashboard_metrics"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
  }
});
