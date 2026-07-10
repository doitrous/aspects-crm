import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRecipients,
  renderTemplate,
  buildDedupeKey,
  isEmail,
  normalizeEmails,
} from "./rules";

test("parseRecipients keeps valid specs and drops junk", () => {
  const specs = parseRecipients([
    { type: "static", value: "a@b.com" },
    { type: "involved_lead" },
    { type: "bogus" },
    "nope",
    { type: "role", value: "auditor" },
  ]);
  assert.equal(specs.length, 3);
  assert.deepEqual(specs[0], { type: "static", value: "a@b.com" });
  assert.deepEqual(specs[1], { type: "involved_lead", value: undefined });
  assert.deepEqual(specs[2], { type: "role", value: "auditor" });
});

test("renderTemplate substitutes and blanks unknowns", () => {
  const out = renderTemplate("Hi {{patient_name}}, on {{date}} — {{missing}}", {
    patient_name: "Sara",
    date: "2026-07-09",
  });
  assert.equal(out, "Hi Sara, on 2026-07-09 — ");
});

test("buildDedupeKey buckets by window so same day collides, next day differs", () => {
  const day = 24 * 3_600_000;
  const k1 = buildDedupeKey("overdue_leads_daily", "2026-07-09", 20, 10 * 3_600_000);
  const k2 = buildDedupeKey("overdue_leads_daily", "2026-07-09", 20, 15 * 3_600_000);
  const k3 = buildDedupeKey("overdue_leads_daily", "2026-07-09", 20, 10 * 3_600_000 + day);
  assert.equal(k1, k2); // same 20h bucket → deduped
  assert.notEqual(k1, k3); // next day → allowed
});

test("buildDedupeKey with no window dedupes forever", () => {
  const k1 = buildDedupeKey("booking_created", "appt-1", null, 1000);
  const k2 = buildDedupeKey("booking_created", "appt-1", 0, 999_999_999);
  assert.equal(k1, "booking_created:appt-1");
  assert.equal(k2, "booking_created:appt-1");
});

test("email validation + normalization dedupes and lowercases", () => {
  assert.ok(isEmail("x@y.com"));
  assert.ok(!isEmail("nope"));
  assert.deepEqual(
    normalizeEmails(["A@B.com", "a@b.com ", null, "bad", "c@d.io"]),
    ["a@b.com", "c@d.io"],
  );
});
