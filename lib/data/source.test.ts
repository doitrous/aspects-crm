import test from "node:test";
import assert from "node:assert/strict";
import { resolveCrmDataSource } from "@/lib/data/source";

test("CRM data source defaults to live Supabase", () => {
  assert.equal(resolveCrmDataSource(undefined, "development"), "supabase");
});

test("mock data source is explicit in development", () => {
  assert.equal(resolveCrmDataSource("mock", "development"), "mock");
});

test("mock data source is refused in production", () => {
  assert.throws(
    () => resolveCrmDataSource("mock", "production"),
    /not allowed in production/,
  );
});
