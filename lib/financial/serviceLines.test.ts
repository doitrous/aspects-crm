import assert from "node:assert/strict";
import { test } from "node:test";
import { serviceBillTotal } from "./serviceLines";

test("multiple added services produce one bill total", () => {
  assert.equal(serviceBillTotal([{ billPrice: 1000 }, { billPrice: 250.25 }, { billPrice: 49.75 }]), 1300);
});

test("editing one service price changes only the current bill total", () => {
  const catalogueSnapshots = [1000, 500];
  const total = serviceBillTotal([{ billPrice: 850 }, { billPrice: 500 }]);
  assert.equal(total, 1350);
  assert.deepEqual(catalogueSnapshots, [1000, 500]);
});

test("removing a service recalculates the remaining bill", () => {
  const lines = [{ billPrice: 600 }, { billPrice: 400 }, { billPrice: 250 }];
  assert.equal(serviceBillTotal(lines.filter((_, index) => index !== 1)), 850);
  assert.equal(serviceBillTotal([]), 0);
});
