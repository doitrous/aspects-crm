import assert from "node:assert/strict";
import test from "node:test";

import { parseOptionalLeadPhone } from "./leadProfile";

test("lead profile phone is optional", () => {
  assert.equal(parseOptionalLeadPhone(""), null);
  assert.equal(parseOptionalLeadPhone("   "), null);
});

test("lead profile phone keeps country code and normalized identity", () => {
  assert.deepEqual(parseOptionalLeadPhone("+20 010 1234 5678"), {
    countryCode: "+20",
    phoneNumber: "010 1234 5678",
    normalizedPhone: "2001012345678",
  });
});
