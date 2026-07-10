import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeAuditorMetrics,
  auditorRedFlags,
  mergeOverrides,
  type AuditorRawCounts,
} from "./kpi";

const base: AuditorRawCounts = {
  totalLeads: 20,
  qualifiedLeads: 10,
  bookedLeads: 4,
  droppedLeads: 6,
  escalations: 1,
  paymentsCollectedEgp: 15000,
  marketingSpendEgp: 4000,
  targetCplEgp: 150,
};

test("computeAuditorMetrics derives percentages and costs", () => {
  const m = computeAuditorMetrics(base);
  assert.equal(m.total_leads, 20);
  assert.equal(m.qualification_percent, 50); // 10/20
  assert.equal(m.booking_percent, 20); // 4/20
  assert.equal(m.drop_off_percent, 30); // 6/20
  assert.equal(m.booking_conversion_rate, 40); // 4/10
  assert.equal(m.cpl, 200); // 4000/20
  assert.equal(m.cost_per_booking, 1000); // 4000/4
  assert.equal(m.cost_per_qualified_lead, 400); // 4000/10
  assert.equal(m.total_payment_egp, 15000);
});

test("divide-by-zero guards return 0, never NaN", () => {
  const m = computeAuditorMetrics({
    ...base,
    totalLeads: 0,
    qualifiedLeads: 0,
    bookedLeads: 0,
    droppedLeads: 0,
    marketingSpendEgp: 0,
  });
  assert.equal(m.qualification_percent, 0);
  assert.equal(m.cpl, 0);
  assert.equal(m.cost_per_booking, 0);
  assert.ok(!Number.isNaN(m.booking_conversion_rate));
});

test("red flags fire when CPL exceeds target and drop-off is high", () => {
  const m = computeAuditorMetrics(base); // cpl 200 > target 150, drop-off 30
  const flags = auditorRedFlags(m);
  const keys = flags.map((f) => f.key);
  assert.ok(keys.includes("cpl"));
  assert.ok(!keys.includes("drop_off_percent")); // 30 < 50
});

test("overriding total_leads recomputes derived CPL and percentages", () => {
  const auto = computeAuditorMetrics(base);
  const merged = mergeOverrides(auto, { total_leads: 40 });
  assert.equal(merged.total_leads, 40);
  assert.equal(merged.cpl, 100); // 4000/40
  assert.equal(merged.qualification_percent, 25); // 10/40
});

test("overriding marketing spend flows into cost metrics", () => {
  const auto = computeAuditorMetrics(base);
  const merged = mergeOverrides(auto, { marketing_spend_egp: 8000 });
  assert.equal(merged.cpl, 400); // 8000/20
  assert.equal(merged.cost_per_booking, 2000); // 8000/4
});
