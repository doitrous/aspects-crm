import test from "node:test";
import assert from "node:assert/strict";
import { deriveLeadBookingSummary, withBookingStatus } from "./leadSummary";

test("a cancelled appointment produces a red cancellation status, not unconfirmed", () => {
  const metadata = withBookingStatus({}, "appointment-1", "cancelled", "crm");
  assert.deepEqual(deriveLeadBookingSummary(metadata), {
    status: "cancelled",
    count: 1,
    context: "Booking cancelled",
  });
});

test("multiple appointments prioritize the current active booking and explain history", () => {
  let metadata = withBookingStatus({}, "appointment-1", "cancelled", "website");
  metadata = withBookingStatus(metadata, "appointment-2", "confirmed", "crm");
  const result = deriveLeadBookingSummary(metadata);
  assert.equal(result.status, "confirmed");
  assert.equal(result.count, 2);
  assert.equal(result.context, "2 bookings · 1 confirmed · 1 previous");
});

test("multiple historical appointments retain attended and cancellation context", () => {
  let metadata = withBookingStatus({}, "appointment-1", "attended");
  metadata = withBookingStatus(metadata, "appointment-2", "cancelled");
  assert.deepEqual(deriveLeadBookingSummary(metadata), {
    status: "completed",
    count: 2,
    context: "2 bookings · 1 attended · 1 cancelled",
  });
});

test("legacy appointment metadata is still understood", () => {
  assert.equal(deriveLeadBookingSummary({ booking_status: "confirmed" }, "legacy-1").status, "confirmed");
});
