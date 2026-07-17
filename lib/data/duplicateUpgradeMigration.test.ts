import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const upgrade = readFileSync(new URL("../../supabase/migrations/0037_lead_drawer_financial_and_duplicate_upgrade.sql", import.meta.url), "utf8");
const baseline = readFileSync(new URL("../../supabase/baseline/014_crm_schema.sql", import.meta.url), "utf8");
const filtering = readFileSync(new URL("../../supabase/migrations/0042_duplicate_queue_filtering.sql", import.meta.url), "utf8");

test("duplicate backfill calls the same live detectors in bounded batches", () => {
  assert.match(upgrade, /crm_flag_duplicate_for_lead\(target\.id\)/);
  assert.match(upgrade, /crm_flag_priority_identifiers\(target\.id\)/);
  assert.match(upgrade, /limit least\(greatest\(batch_size, 1\), 1000\)/);
});

test("unchanged duplicate evidence remains idempotent across backfill runs", () => {
  assert.match(baseline, /unique \(lead_id, duplicate_lead_id, duplicate_type, identifier_value\)/);
  assert.match(upgrade, /canonical-pair uniqueness makes every retry idempotent/i);
});

test("duplicate review filters both patient records before pagination", () => {
  assert.match(filtering, /join public\.leads as primary_lead/);
  assert.match(filtering, /join public\.leads as duplicate_lead/);
  assert.ok(filtering.indexOf("matching as") < filtering.indexOf("page_rows as"));
  for (const field of ["name", "phone", "mrn", "lead_id", "platform_id"]) assert.match(filtering, new RegExp(`when '${field}'`));
});

test("same-patient linking preserves leads and records a canonical audited decision", () => {
  const functionBody = upgrade.slice(upgrade.indexOf("crm_link_duplicate_same_patient"), upgrade.indexOf("-- Batch existing records"));
  assert.doesNotMatch(functionBody, /delete from public\.leads/i);
  assert.match(functionBody, /canonical_patient_id/);
  assert.match(functionBody, /duplicate\.same_patient_linked/);
  assert.match(functionBody, /original_lead_ids/);
});

test("family and care relationships support separate directional patient identities", () => {
  for (const relationship of ["parent", "child", "spouse", "sibling", "same_household", "guardian", "caregiver", "related_contact"]) {
    assert.match(upgrade, new RegExp(`'${relationship}'`));
  }
  assert.match(upgrade, /relationship_source_lead_id/);
  assert.match(upgrade, /Assign a separate MRN to both people/);
  assert.match(upgrade, /created_from_relationship_review/);
  assert.match(upgrade, /patient_ids/);
});
