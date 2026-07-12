import test from "node:test";
import assert from "node:assert/strict";
import { autoMapLeadHeaders, mapLeadImportRow } from "./leadImportMapping";

test("patient headers are mapped without relying on column order", () => {
  const headers = ["الخدمة", "MRN", "Patient Name", "رقم التليفون"];
  assert.deepEqual(autoMapLeadHeaders(headers), {
    "الخدمة": "serviceName",
    MRN: "mrn",
    "Patient Name": "name",
    "رقم التليفون": "phone",
  });
});

test("patient rows require identity fields but not financial, service, or doctor columns", () => {
  const headers = ["Name", "Phone", "MRN", "Nationality", "Service"];
  const mapping = autoMapLeadHeaders(headers);
  const row = mapLeadImportRow(["Omar Yasser", "01012345678", "1", "Egyptian", "Consultation"], headers, mapping, 0);
  assert.equal(row.errors.length, 0);
  assert.equal(row.name, "Omar Yasser");
  assert.equal(row.serviceName, "Consultation");
});

test("only MRN, name, phone and nationality create blocking errors", () => {
  const headers = ["Name", "Phone", "MRN", "Nationality", "Age"];
  const mapping = autoMapLeadHeaders(headers);
  const row = mapLeadImportRow(["", "123", "12A4", "", "121"], headers, mapping, 0);
  assert.deepEqual(row.errorFields, ["name", "phone", "mrn", "nationality"]);
  assert.equal(row.errors.length, 4);
  assert.equal(row.warnings.length, 0);
});

test("MRN accepts every digit length from 1 through 9", () => {
  const headers = ["Name", "Phone", "MRN", "Nationality"];
  const mapping = autoMapLeadHeaders(headers);
  for (let digits = 1; digits <= 9; digits++) {
    const row = mapLeadImportRow(["Patient", "01012345678", "1".repeat(digits), "Egyptian"], headers, mapping, 0);
    assert.equal(row.errors.length, 0);
  }
  assert.equal(mapLeadImportRow(["Patient", "01012345678", "1234567890", "Egyptian"], headers, mapping, 0).errorFields.includes("mrn"), true);
});
