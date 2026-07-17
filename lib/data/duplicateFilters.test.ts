import assert from "node:assert/strict";
import test from "node:test";
import { duplicateMatchesFilters, normalizeDuplicateFilters } from "@/lib/data/duplicateFilters";
import type { DuplicatePair } from "@/lib/types";

const pair: DuplicatePair = {
  id: "flag-1",
  type: "phone",
  confidence: 1,
  status: "suspected",
  createdAt: "2026-07-17T00:00:00Z",
  notes: "+20 100 555 0101",
  primary: { id: "L00012", name: "Ahmed Hassan Ali", phone: "+20 100 555 0101", mrn: "71234", platformId: "ig-88", stage: "new", platform: "instagram", createdAt: "2026-07-17T00:00:00Z" },
  duplicate: { id: "L00419", name: "Ahmed H. Ali", phone: "01005550101", mrn: "", stage: "new", platform: "instagram", createdAt: "2026-07-17T00:00:00Z" },
};

test("duplicate filters find either record by name, phone, MRN, lead number and platform id", () => {
  assert.equal(duplicateMatchesFilters(pair, { q: "Hassan", field: "name" }), true);
  assert.equal(duplicateMatchesFilters(pair, { q: "01005550101", field: "phone" }), true);
  assert.equal(duplicateMatchesFilters(pair, { q: "71234", field: "mrn" }), true);
  assert.equal(duplicateMatchesFilters(pair, { q: "L00419", field: "lead_id" }), true);
  assert.equal(duplicateMatchesFilters(pair, { q: "ig-88", field: "platform_id" }), true);
});

test("match-type filter composes with identity search", () => {
  assert.equal(duplicateMatchesFilters(pair, { q: "Ahmed", field: "name", matchType: "phone" }), true);
  assert.equal(duplicateMatchesFilters(pair, { q: "Ahmed", field: "name", matchType: "mrn" }), false);
});

test("unsafe filter syntax is normalized before it reaches PostgREST", () => {
  assert.deepEqual(normalizeDuplicateFilters({ q: "  Ali%,()  ", field: "invalid" as "all", matchType: "phone);drop" }), {
    q: "Ali",
    field: "all",
    matchType: "phonedrop",
  });
});
