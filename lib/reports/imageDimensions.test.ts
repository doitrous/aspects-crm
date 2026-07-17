import assert from "node:assert/strict";
import test from "node:test";
import { reportImageDimensions } from "@/lib/reports/imageDimensions";

test("ordinary reports export at readable high resolution", () => {
  assert.deepEqual(reportImageDimensions(1000, 2000), { width: 1800, height: 3600, scale: 1.8 });
});

test("tall auditor reports remain within conservative browser canvas limits", () => {
  const dimensions = reportImageDimensions(1400, 18000);
  assert.ok(dimensions.width <= 8192);
  assert.ok(dimensions.height <= 8192);
  assert.ok(dimensions.width * dimensions.height <= 16_000_000);
});
