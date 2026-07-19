import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migration = readFileSync(new URL("../../supabase/migrations/0043_lead_trash_retention.sql", import.meta.url), "utf8");
const provider = readFileSync(new URL("./supabase.ts", import.meta.url), "utf8");
const detail = readFileSync(new URL("../loadLeadDetail.ts", import.meta.url), "utf8");

test("lead trash migration enforces an atomic 30-day lifecycle", () => {
  assert.match(migration, /crm_trash_lead/);
  assert.match(migration, /deleted_time \+ interval '30 days'/);
  assert.match(migration, /crm_restore_trashed_lead/);
  assert.match(migration, /crm_purge_expired_lead_trash/);
  assert.match(migration, /lead\.deleted_at is not null/);
});

test("trash database functions are service-role only", () => {
  for (const fn of ["crm_trash_lead", "crm_restore_trashed_lead", "crm_purge_trashed_lead", "crm_purge_expired_lead_trash"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
  }
});

test("ordinary lists and direct drawer loads require active leads", () => {
  assert.match(provider, /select\(LEAD_COLUMNS, \{ count: "exact" \}\)\.is\("deleted_at", null\)/);
  assert.match(detail, /eq\("lead_id", id\)\s*\.is\("deleted_at", null\)/);
});
