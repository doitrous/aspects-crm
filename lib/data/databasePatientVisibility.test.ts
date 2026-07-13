import assert from "node:assert/strict";
import test from "node:test";
import {
  isDatabasePatientSource,
  NON_DATABASE_PATIENT_FILTER,
} from "./databasePatientVisibility";

test("Database patients are excluded by their canonical source", () => {
  assert.equal(isDatabasePatientSource("Database"), true);
  assert.equal(isDatabasePatientSource(" database "), true);
  assert.equal(isDatabasePatientSource("Website"), false);
  assert.equal(isDatabasePatientSource(undefined), false);
});

test("the database exclusion does not let revisiting imports leak into New Leads", () => {
  assert.equal(NON_DATABASE_PATIENT_FILTER.includes("record_source.neq.database"), true);
  assert.equal(NON_DATABASE_PATIENT_FILTER.includes("revisiting_patient"), false);
});
