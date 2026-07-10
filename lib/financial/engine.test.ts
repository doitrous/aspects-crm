import { test } from "node:test";
import assert from "node:assert/strict";
import { addMoney, clamp, pctOf, pctRatio, roundMoney, subMoney } from "./money";
import { computeFinancials, type FinancialInput } from "./engine";
import { resolveMaxDiscount, type DiscountRule } from "./rules";

/* ── money helpers ───────────────────────────────────────────── */

test("addMoney has no float drift (0.1 + 0.2 === 0.3)", () => {
  assert.equal(addMoney(0.1, 0.2), 0.3);
});

test("addMoney sums many values exactly", () => {
  assert.equal(addMoney(19.99, 19.99, 19.99), 59.97);
});

test("subMoney is exact at cent precision", () => {
  assert.equal(subMoney(0.3, 0.1), 0.2);
});

test("roundMoney rounds half away from zero", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(-1.005), -1.01);
});

test("money helpers coerce non-finite to 0", () => {
  assert.equal(addMoney(NaN, 5), 5);
  assert.equal(subMoney(Infinity, 1), -1);
  assert.equal(roundMoney(NaN), 0);
});

test("pctOf handles 0 percent and is rounded", () => {
  assert.equal(pctOf(1000, 0), 0);
  assert.equal(pctOf(1000, 15), 150);
  assert.equal(pctOf(333.33, 10), 33.33);
});

test("pctRatio is safe when denominator is 0", () => {
  assert.equal(pctRatio(50, 0), 0);
  assert.equal(pctRatio(25, 100), 25);
});

test("clamp bounds values and maps non-finite to min", () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-5, 0, 100), 0);
  assert.equal(clamp(NaN, 0, 100), 0);
});

/* ── pricing & discount (§1B, §11) ───────────────────────────── */

const baseInput: FinancialInput = {
  baseServicePrice: 1000,
  quotedPrice: 800,
  maxAllowedDiscountPct: 25,
};

test("effective discount is derived from base and quoted", () => {
  const s = computeFinancials(baseInput);
  assert.equal(s.discountAmount, 200);
  assert.equal(s.effectiveDiscountPct, 20);
  assert.equal(s.minAllowedQuotedPrice, 750);
  assert.equal(s.isBelowAllowed, false);
});

test("quote exactly at the allowed minimum is NOT flagged", () => {
  const s = computeFinancials({ ...baseInput, quotedPrice: 750 });
  assert.equal(s.effectiveDiscountPct, 25);
  assert.equal(s.isBelowAllowed, false);
});

test("quote below the allowed minimum IS flagged", () => {
  const s = computeFinancials({ ...baseInput, quotedPrice: 749.99 });
  assert.equal(s.isBelowAllowed, true);
});

test("not-yet-quoted lead has hasQuote=false and is not flagged", () => {
  const s = computeFinancials({ ...baseInput, quotedPrice: null });
  assert.equal(s.hasQuote, false);
  assert.equal(s.quotedPrice, 0);
  assert.equal(s.isBelowAllowed, false);
});

test("quote above list price is a negative discount (surcharge)", () => {
  const s = computeFinancials({ ...baseInput, quotedPrice: 1100 });
  assert.equal(s.discountAmount, -100);
  assert.equal(s.effectiveDiscountPct, -10);
  assert.equal(s.isBelowAllowed, false);
});

test("zero base price does not divide by zero", () => {
  const s = computeFinancials({ baseServicePrice: 0, quotedPrice: 0, maxAllowedDiscountPct: 10 });
  assert.equal(s.effectiveDiscountPct, 0);
  assert.equal(s.minAllowedQuotedPrice, 0);
});

test("maxAllowedDiscountPct is clamped to 0..100", () => {
  const over = computeFinancials({ ...baseInput, maxAllowedDiscountPct: 200 });
  assert.equal(over.maxAllowedDiscountPct, 100);
  assert.equal(over.minAllowedQuotedPrice, 0);
});

/* ── payments ledger (§1C–E, H) ──────────────────────────────── */

test("actualPaid nets payments against refunds/reversals/chargebacks", () => {
  const s = computeFinancials({
    ...baseInput,
    transactions: [
      { kind: "payment", amount: 500 },
      { kind: "payment", amount: 200 },
      { kind: "refund", amount: 100 },
      { kind: "chargeback", amount: 50 },
    ],
  });
  assert.equal(s.grossPaid, 700);
  assert.equal(s.reversalsTotal, 150);
  assert.equal(s.actualPaid, 550);
});

test("outstanding reflects amount due minus everything collected", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    transactions: [{ kind: "payment", amount: 600 }],
  });
  assert.equal(s.amountDue, 800);
  assert.equal(s.outstanding, 200);
});

test("credit note reduces amount due without being cash", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    transactions: [
      { kind: "payment", amount: 700 },
      { kind: "credit_note", amount: 100 },
    ],
  });
  assert.equal(s.amountDue, 700);
  assert.equal(s.actualPaid, 700);
  assert.equal(s.outstanding, 0);
});

test("cancellation adjustment reduces amount due like a credit, not as cash", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    transactions: [
      { kind: "payment", amount: 500 },
      { kind: "cancellation_adjustment", amount: 300 },
    ],
  });
  assert.equal(s.creditsTotal, 300);
  assert.equal(s.actualPaid, 500); // adjustment is not cash
  assert.equal(s.amountDue, 500); // 800 - 300
  assert.equal(s.outstanding, 0);
});

test("credits and cancellation adjustments accumulate together", () => {
  const s = computeFinancials({
    ...baseInput,
    transactions: [
      { kind: "credit_note", amount: 100 },
      { kind: "cancellation_adjustment", amount: 50 },
    ],
  });
  assert.equal(s.creditsTotal, 150);
  assert.equal(s.amountDue, 650); // 800 - 150
});

test("doctor-funded payment counts as collected but tracked separately", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    transactions: [
      { kind: "payment", amount: 500 },
      { kind: "doctor_funded", amount: 300 },
    ],
  });
  assert.equal(s.actualPaid, 500);
  assert.equal(s.doctorFundedTotal, 300);
  assert.equal(s.totalCollected, 800);
  assert.equal(s.outstanding, 0);
});

test("overpayment yields negative outstanding", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    transactions: [{ kind: "payment", amount: 900 }],
  });
  assert.equal(s.outstanding, -100);
});

test("transaction magnitudes are taken as absolute", () => {
  const s = computeFinancials({
    ...baseInput,
    transactions: [{ kind: "payment", amount: -500 }],
  });
  assert.equal(s.grossPaid, 500);
});

test("non-finite transaction amounts are ignored (treated as 0)", () => {
  const s = computeFinancials({
    ...baseInput,
    transactions: [
      { kind: "payment", amount: Number.NaN },
      { kind: "payment", amount: 100 },
    ],
  });
  assert.equal(s.grossPaid, 100);
});

/* ── consumables, doctor comp, external, profitability (§8, §9) ─ */

test("consumables and net-after-consumables", () => {
  const s = computeFinancials({ ...baseInput, consumablesTotal: 120 });
  assert.equal(s.consumablesTotal, 120);
  assert.equal(s.netAfterConsumables, 680); // 800 - 120
});

test("percentage doctor compensation on quoted price", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    doctorCompensations: [{ doctorId: "d1", kind: "percentage", value: 10 }],
  });
  assert.equal(s.doctorCompensations[0].amount, 80);
  assert.equal(s.doctorCompensationTotal, 80);
});

test("percentage doctor compensation on net-after-consumables basis", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    consumablesTotal: 200,
    doctorCompensations: [
      { doctorId: "d1", kind: "percentage", value: 10, basis: "net_after_consumables" },
    ],
  });
  assert.equal(s.netAfterConsumables, 600);
  assert.equal(s.doctorCompensations[0].amount, 60);
});

test("bundle: multiple doctors mixing percentage and fixed (§7)", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    doctorCompensations: [
      { doctorId: "surgeon", kind: "percentage", value: 15 }, // 120
      { doctorId: "anesthetist", kind: "fixed", value: 200 }, // 200
    ],
  });
  assert.equal(s.doctorCompensations.length, 2);
  assert.equal(s.doctorCompensationTotal, 320);
});

test("net profit = quoted - consumables - doctorComp - external", () => {
  const s = computeFinancials({
    ...baseInput, // quoted 800
    consumablesTotal: 100,
    doctorCompensations: [{ doctorId: "d1", kind: "fixed", value: 150 }],
    externalCostsTotal: 50,
  });
  assert.equal(s.netProfit, 500); // 800 - 100 - 150 - 50
});

test("empty/default input never produces NaN and is all zero", () => {
  const s = computeFinancials({ baseServicePrice: 0, quotedPrice: null, maxAllowedDiscountPct: 0 });
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === "number") assert.ok(Number.isFinite(v), `${k} must be finite`);
  }
  assert.equal(s.netProfit, 0);
  assert.equal(s.outstanding, 0);
});

/* ── discount-rule precedence (§3) ───────────────────────────── */

const rules: DiscountRule[] = [
  { scope: "global", maxDiscountPct: 10 },
  { scope: "service", serviceId: "svcA", maxDiscountPct: 20 },
  { scope: "moderator", moderatorId: "modX", maxDiscountPct: 30 },
  { scope: "moderator_service", moderatorId: "modX", serviceId: "svcA", maxDiscountPct: 40 },
];

test("precedence: moderator+service wins over all", () => {
  const r = resolveMaxDiscount(rules, { moderatorId: "modX", serviceId: "svcA" });
  assert.equal(r.maxDiscountPct, 40);
  assert.equal(r.rule?.scope, "moderator_service");
});

test("precedence: moderator beats service and global", () => {
  const r = resolveMaxDiscount(rules, { moderatorId: "modX", serviceId: "svcB" });
  assert.equal(r.maxDiscountPct, 30);
});

test("precedence: service beats global", () => {
  const r = resolveMaxDiscount(rules, { moderatorId: "modY", serviceId: "svcA" });
  assert.equal(r.maxDiscountPct, 20);
});

test("precedence: global default when nothing else matches", () => {
  const r = resolveMaxDiscount(rules, { moderatorId: "modY", serviceId: "svcB" });
  assert.equal(r.maxDiscountPct, 10);
});

test("no matching rule and no global default resolves to 0", () => {
  const r = resolveMaxDiscount(
    [{ scope: "service", serviceId: "svcA", maxDiscountPct: 20 }],
    { moderatorId: "modY", serviceId: "svcB" },
  );
  assert.equal(r.maxDiscountPct, 0);
  assert.equal(r.rule, null);
});

test("resolved rule feeds the engine's allowed-minimum check end-to-end", () => {
  const { maxDiscountPct } = resolveMaxDiscount(rules, { moderatorId: "modY", serviceId: "svcA" }); // 20
  const s = computeFinancials({ baseServicePrice: 1000, quotedPrice: 780, maxAllowedDiscountPct: maxDiscountPct });
  assert.equal(s.minAllowedQuotedPrice, 800);
  assert.equal(s.isBelowAllowed, true); // 780 < 800
});
