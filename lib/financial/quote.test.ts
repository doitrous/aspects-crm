import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateQuote } from "./quote";

const BASE = { baseServicePrice: 1000, maxAllowedDiscountPct: 20, viewerCanForce: false };

test("a blank price is neither valid nor an error", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: null });
  assert.equal(q.status, "empty");
  assert.equal(q.isError, false);
  assert.equal(q.message, null);
});

test("a quote inside the allowed discount is clean", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 850 });
  assert.equal(q.status, "ok");
  assert.equal(q.isError, false);
  assert.equal(q.effectiveDiscountPct, 15);
  assert.equal(q.minAllowedQuotedPrice, 800);
  assert.equal(q.canEscalate, false);
});

test("a quote exactly at the allowed minimum is allowed, not flagged", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 800 });
  assert.equal(q.status, "ok");
  assert.equal(q.isError, false);
  assert.equal(q.effectiveDiscountPct, 20);
});

test("a quote one cent below the minimum is flagged", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 799.99 });
  assert.equal(q.status, "below_allowed");
  assert.equal(q.isError, true);
  assert.equal(q.shortfall, 0.01);
});

test("a below-allowed quote reports every number the spec requires", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 700 });
  assert.equal(q.status, "below_allowed");
  assert.equal(q.isError, true);
  assert.equal(q.effectiveDiscountPct, 30);
  assert.equal(q.maxAllowedDiscountPct, 20);
  assert.equal(q.minAllowedQuotedPrice, 800);
  assert.equal(q.shortfall, 100);
  assert.match(q.message!, /30%/);
  assert.match(q.message!, /20%/);
  assert.match(q.message!, /800/);
});

test("a moderator may always escalate a below-allowed quote but never force it", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 700, viewerCanForce: false });
  assert.equal(q.canEscalate, true);
  assert.equal(q.canForce, false);
});

test("an authorized approver may force, and is still shown the warning", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 700, viewerCanForce: true });
  assert.equal(q.canForce, true);
  assert.equal(q.isError, true, "force-approval must not silence the warning");
  assert.equal(q.message !== null, true);
});

test("an allowed quote never grants force, even to an approver", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 900, viewerCanForce: true });
  assert.equal(q.canForce, false);
  assert.equal(q.canEscalate, false);
});

test("a zero max-discount rule forbids any discount at all", () => {
  const q = evaluateQuote({ baseServicePrice: 500, quotedPrice: 499, maxAllowedDiscountPct: 0, viewerCanForce: false });
  assert.equal(q.status, "below_allowed");
  assert.equal(q.minAllowedQuotedPrice, 500);
  const exact = evaluateQuote({ baseServicePrice: 500, quotedPrice: 500, maxAllowedDiscountPct: 0, viewerCanForce: false });
  assert.equal(exact.status, "ok");
});

test("a negative or non-finite price is invalid, not a discount", () => {
  assert.equal(evaluateQuote({ ...BASE, quotedPrice: -1 }).status, "invalid");
  assert.equal(evaluateQuote({ ...BASE, quotedPrice: Number.NaN }).status, "invalid");
  assert.equal(evaluateQuote({ ...BASE, quotedPrice: Number.POSITIVE_INFINITY }).status, "invalid");
  assert.equal(evaluateQuote({ ...BASE, quotedPrice: -1 }).isError, true);
});

test("a quote above list price is a surcharge, not an error", () => {
  const q = evaluateQuote({ ...BASE, quotedPrice: 1200 });
  assert.equal(q.status, "ok");
  assert.equal(q.isError, false);
  assert.equal(q.isSurcharge, true);
  assert.equal(q.effectiveDiscountPct, -20);
  assert.match(q.message!, /above/);
});

test("a zero base price cannot be discounted below zero", () => {
  const q = evaluateQuote({ baseServicePrice: 0, quotedPrice: 0, maxAllowedDiscountPct: 50, viewerCanForce: false });
  assert.equal(q.status, "ok");
  assert.equal(q.minAllowedQuotedPrice, 0);
  assert.equal(q.effectiveDiscountPct, 0);
});
