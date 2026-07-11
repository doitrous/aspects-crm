import assert from "node:assert/strict";
import test from "node:test";
import { mergeMessages } from "./merge";
import type { Message } from "@/lib/types";

function message(id: string, channel: Message["channel"], body: string, createdAt: string, seenAt?: string): Message {
  return {
    id,
    leadId: "L0019",
    channel,
    direction: "outgoing",
    body,
    createdAt,
    deliveryStatus: seenAt ? "seen" : "sent",
    seenAt,
  };
}

test("overview and channel payloads merge without dropping conversation rows", () => {
  const full = [
    message("m1", "facebook", "First", "2026-07-11T10:00:00Z"),
    message("m2", "instagram", "Second", "2026-07-11T10:01:00Z"),
  ];
  const overview = [message("m2", "instagram", "Second", "2026-07-11T10:01:00Z")];
  assert.deepEqual(mergeMessages(full, overview).map((item) => item.id), ["m1", "m2"]);
});

test("fresh receipt metadata replaces the cached copy of the same message", () => {
  const cached = [message("m1", "facebook", "Hello", "2026-07-11T10:00:00Z")];
  const fresh = [message("m1", "facebook", "Hello", "2026-07-11T10:00:00Z", "2026-07-11T10:05:00Z")];
  const result = mergeMessages(cached, fresh);
  assert.equal(result.length, 1);
  assert.equal(result[0].deliveryStatus, "seen");
  assert.equal(result[0].seenAt, "2026-07-11T10:05:00Z");
});
