import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSafeExternalUrl } from "./externalUrl";

test("conversation links accept and normalize HTTP(S) URLs", () => {
  assert.equal(normalizeSafeExternalUrl(" https://example.com/chat?id=1 "), "https://example.com/chat?id=1");
  assert.equal(normalizeSafeExternalUrl("http://example.com/thread"), "http://example.com/thread");
});

test("conversation links reject unsafe and non-web protocols", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/a", "mailto:user@example.com"]) {
    assert.throws(() => normalizeSafeExternalUrl(value), /http:\/\/.*https:\/\//);
  }
});

test("an empty value is valid for removing a conversation link", () => {
  assert.equal(normalizeSafeExternalUrl("  "), "");
});
