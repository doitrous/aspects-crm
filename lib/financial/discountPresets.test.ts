import assert from "node:assert/strict";
import { test } from "node:test";
import { discountPresets } from "./discountPresets";

test("a 10 percent allowance produces the required four presets", () => {
  assert.deepEqual(discountPresets(10), [0, 5, 7.5, 10]);
});

test("presets scale to the current moderator allowance", () => {
  assert.deepEqual(discountPresets(20), [0, 10, 15, 20]);
  assert.deepEqual(discountPresets(8), [0, 4, 6, 8]);
});

test("zero allowance renders one unambiguous zero preset", () => {
  assert.deepEqual(discountPresets(0), [0]);
});
