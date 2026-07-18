import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeWebsiteCallbackPhone,
  parseWebsiteCallbackPayload,
  WEBSITE_CALLBACK_TAG,
} from "./callback";

test("parses the website callback event currently emitted by Aspects", () => {
  assert.deepEqual(parseWebsiteCallbackPayload({
    event_type: "callback_request",
    request_id: "request-123",
    name: "Patient Name",
    phone_country_code: "+20",
    phone: "010 1234 5678",
    email: "patient@example.com",
    message: "Please call after 5",
    language: "en",
    source_path: "/en/contact",
    created_at: "2026-07-18T12:00:00.000Z",
  }), {
    callbackRequestId: "request-123",
    patientName: "Patient Name",
    phoneCountryCode: "+20",
    phoneNumber: "010 1234 5678",
    patientEmail: "patient@example.com",
    message: "Please call after 5",
    language: "en",
    sourcePath: "/en/contact",
    createdAt: "2026-07-18T12:00:00.000Z",
  });
});

test("requires a callback id and patient name", () => {
  assert.equal(parseWebsiteCallbackPayload({ name: "Patient" }), null);
  assert.equal(parseWebsiteCallbackPayload({ request_id: "request-123" }), null);
  assert.equal(parseWebsiteCallbackPayload(null), null);
});

test("normalizes the callback phone for CRM matching", () => {
  assert.equal(normalizeWebsiteCallbackPhone("+20", "010 1234-5678"), "2001012345678");
  assert.equal(normalizeWebsiteCallbackPhone(undefined, undefined), null);
  assert.equal(WEBSITE_CALLBACK_TAG, "Website - Callback");
});
