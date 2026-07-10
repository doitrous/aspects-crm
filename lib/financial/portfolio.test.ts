import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProfitability } from "@/lib/financial/portfolio";

test("computeProfitability folds records into portfolio totals", () => {
  const s = computeProfitability({
    baseServicePrices: [1000, 2000],
    quotedPrices: [900, 1800], // recognized revenue 2700
    consumablesTotal: 300,
    doctorCompensationTotal: 500,
    externalCostsTotal: 200,
  });
  assert.equal(s.grossServiceValue, 3000);
  assert.equal(s.totalQuotedValue, 2700);
  assert.equal(s.recognizedRevenue, 2700);
  assert.equal(s.totalDiscounts, 300); // 3000 - 2700
  assert.equal(s.totalDirectCosts, 1000); // 300 + 500 + 200
  assert.equal(s.netRevenue, 1700); // 2700 - 1000
  // Margin uses the shared pctRatio helper (same as the engine); ~62.96%.
  assert.ok(Math.abs(s.netMarginPercent - (1700 / 2700) * 100) < 1e-9);
  assert.equal(s.recordCount, 2);
});

test("computeProfitability is total: empty input yields zeros, never NaN", () => {
  const s = computeProfitability({
    baseServicePrices: [],
    quotedPrices: [],
    consumablesTotal: 0,
    doctorCompensationTotal: 0,
    externalCostsTotal: 0,
  });
  assert.equal(s.recognizedRevenue, 0);
  assert.equal(s.netRevenue, 0);
  assert.equal(s.netMarginPercent, 0);
  assert.ok(!Number.isNaN(s.netMarginPercent));
});

test("discounts never go negative when quoted exceeds base (surcharge)", () => {
  const s = computeProfitability({
    baseServicePrices: [1000],
    quotedPrices: [1200],
    consumablesTotal: 0,
    doctorCompensationTotal: 0,
    externalCostsTotal: 0,
  });
  assert.equal(s.totalDiscounts, 0);
  assert.equal(s.netRevenue, 1200);
});
