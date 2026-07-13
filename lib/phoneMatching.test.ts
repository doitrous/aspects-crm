import assert from "node:assert/strict";
import test from "node:test";
import { matchablePhoneDigits, phoneDuplicateKey } from "./phoneMatching";

test("phone matching ignores placeholder values with four or fewer digits", () => {
  assert.equal(matchablePhoneDigits("1"), null);
  assert.equal(matchablePhoneDigits("12-34"), null);
  assert.equal(matchablePhoneDigits("12 345"), "12345");
});

test("phone duplicate keys keep short valid numbers exact and normalize long numbers", () => {
  assert.equal(phoneDuplicateKey("12345"), "12345");
  assert.equal(phoneDuplicateKey("+20 101 234 5678"), "012345678");
  assert.equal(
    phoneDuplicateKey("+20 101 234 5678"),
    phoneDuplicateKey("01012345678"),
    "country-code and local representations must identify the same patient",
  );
});
