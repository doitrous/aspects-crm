import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, formatPct } from "./format";

test("money always shows two decimals, so a bill column lines up", () => {
  assert.equal(formatMoney(1500), "1,500.00 EGP");
  assert.equal(formatMoney(1500.5), "1,500.50 EGP");
  assert.equal(formatMoney(0), "0.00 EGP");
});

test("money groups thousands and honours the record's currency", () => {
  assert.equal(formatMoney(1234567.89), "1,234,567.89 EGP");
  assert.equal(formatMoney(250, "USD"), "250.00 USD");
});

test("money renders a negative (a net loss) rather than dropping the sign", () => {
  assert.equal(formatMoney(-320.4), "-320.40 EGP");
});

test("a non-finite amount reads as zero, never as NaN on a bill", () => {
  assert.equal(formatMoney(Number.NaN), "0.00 EGP");
  assert.equal(formatMoney(Number.POSITIVE_INFINITY), "0.00 EGP");
});

test("percentages drop trailing zeros but keep real precision", () => {
  assert.equal(formatPct(20), "20%");
  assert.equal(formatPct(12.5), "12.5%");
  assert.equal(formatPct(33.333333), "33.33%");
  assert.equal(formatPct(0), "0%");
});

test("a non-finite percentage reads as zero", () => {
  assert.equal(formatPct(Number.NaN), "0%");
});
