import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LEAD_TRASH_RETENTION_DAYS,
  permanentDeleteConfirmation,
  trashConfirmation,
  trashDaysRemaining,
} from "./trash";

test("lead trash uses the required 30-day retention period", () => {
  assert.equal(LEAD_TRASH_RETENTION_DAYS, 30);
  assert.equal(trashDaysRemaining("2026-08-18T12:00:00.000Z", new Date("2026-07-19T12:00:00.000Z")), 30);
  assert.equal(trashDaysRemaining("2026-07-19T11:59:59.000Z", new Date("2026-07-19T12:00:00.000Z")), 0);
});

test("destructive confirmations include the exact lead identifier", () => {
  assert.equal(trashConfirmation("L0042"), "MOVE L0042 TO TRASH");
  assert.equal(permanentDeleteConfirmation("L0042"), "DELETE L0042 PERMANENTLY");
});
