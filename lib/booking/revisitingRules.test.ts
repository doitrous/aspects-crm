import assert from "node:assert/strict";
import test from "node:test";
import {
  isRevisitingMetadata,
  normalizePatientMrn,
  withRevisitingMetadata,
} from "./revisitingRules";

test("MRN matching accepts only the clinic's 1 to 9 digit identifiers", () => {
  assert.equal(normalizePatientMrn(" 7 "), "7");
  assert.equal(normalizePatientMrn("123456789"), "123456789");
  assert.equal(normalizePatientMrn("1234567890"), null);
  assert.equal(normalizePatientMrn("MRN-7"), null);
  assert.equal(normalizePatientMrn(undefined), null);
});

test("revisiting metadata preserves database origin and records how it matched", () => {
  const metadata = withRevisitingMetadata(
    { record_source: "database", imported_via: "patient_bulk_import" },
    "mrn",
    "appointment-1",
  );
  assert.equal(metadata.record_source, "database");
  assert.equal(metadata.revisiting_patient, true);
  assert.equal(metadata.revisiting_match, "mrn");
  assert.equal(metadata.revisiting_appointment_id, "appointment-1");
  assert.equal(isRevisitingMetadata(metadata), true);
});

test("only a strict boolean marker identifies a revisiting patient", () => {
  assert.equal(isRevisitingMetadata({ revisiting_patient: "true" }), false);
  assert.equal(isRevisitingMetadata({ revisiting_patient: true }), true);
  assert.equal(isRevisitingMetadata(null), false);
});
