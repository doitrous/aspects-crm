import assert from "node:assert/strict";
import test from "node:test";
import {
  isInsideWhatsAppServiceWindow,
  listApprovedWhatsAppTemplates,
  sendWhatsAppTemplate,
  sendWhatsAppText,
  whatsappRecipient,
  WhatsAppCloudApiError,
  type WhatsAppCloudConfig,
} from "./cloud";

const config: WhatsAppCloudConfig = {
  accessToken: "server-secret",
  phoneNumberId: "123456789",
  businessAccountId: "987654321",
  graphApiVersion: "v25.0",
};

test("normalizes a valid international recipient and rejects incomplete numbers", () => {
  assert.equal(whatsappRecipient("+20 100 123 4567"), "201001234567");
  assert.equal(whatsappRecipient("1234"), null);
  assert.equal(whatsappRecipient("1234567890123456"), null);
});

test("customer-service window is open only for a recent incoming message", () => {
  const now = Date.UTC(2026, 6, 19, 12);
  assert.equal(isInsideWhatsAppServiceWindow("2026-07-18T12:00:01.000Z", now), true);
  assert.equal(isInsideWhatsAppServiceWindow("2026-07-18T12:00:00.000Z", now), false);
  assert.equal(isInsideWhatsAppServiceWindow("invalid", now), false);
  assert.equal(isInsideWhatsAppServiceWindow("2026-07-20T12:00:00.000Z", now), false);
});

test("sends text through the configured Meta phone-number endpoint without exposing the token in the body", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(url);
    requestInit = init;
    return new Response(JSON.stringify({
      contacts: [{ wa_id: "201001234567" }],
      messages: [{ id: "wamid.outbound-1" }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const result = await sendWhatsAppText(config, { to: "+20 100 123 4567", body: " Hello patient " }, fetcher);
  assert.equal(requestUrl, "https://graph.facebook.com/v25.0/123456789/messages");
  assert.equal((requestInit?.headers as Record<string, string>).authorization, "Bearer server-secret");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "201001234567",
    type: "text",
    text: { preview_url: false, body: "Hello patient" },
  });
  assert.equal(String(requestInit?.body).includes("server-secret"), false);
  assert.equal(result.messageId, "wamid.outbound-1");
  assert.equal(result.recipientId, "201001234567");
});

test("surfaces Meta API errors with status and error code", async () => {
  const fetcher = (async () => new Response(JSON.stringify({
    error: { message: "The recipient is not valid", code: 100, error_subcode: 2494010 },
  }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;

  await assert.rejects(
    () => sendWhatsAppText(config, { to: "201001234567", body: "Hello" }, fetcher),
    (error: unknown) => {
      assert.ok(error instanceof WhatsAppCloudApiError);
      assert.equal(error.status, 400);
      assert.equal(error.code, 100);
      assert.equal(error.subcode, 2494010);
      return true;
    },
  );
});

test("loads approved templates and marks unsupported media headers and dynamic buttons", async () => {
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /^https:\/\/graph\.facebook\.com\/v25\.0\/987654321\/message_templates\?/);
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer server-secret");
    return new Response(JSON.stringify({ data: [
      {
        name: "appointment_reminder",
        status: "APPROVED",
        language: "en_US",
        category: "UTILITY",
        components: [{ type: "BODY", text: "Hello {{1}}, your appointment is {{2}}." }],
      },
      {
        name: "photo_offer",
        status: "APPROVED",
        language: "en_US",
        components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Special offer" }],
      },
      {
        name: "track_booking",
        status: "APPROVED",
        language: "en_US",
        components: [
          { type: "BODY", text: "Track your booking" },
          { type: "BUTTONS", buttons: [{ type: "URL", text: "Track", url: "https://example.com/{{1}}" }] },
        ],
      },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const templates = await listApprovedWhatsAppTemplates(config, fetcher);
  assert.equal(templates.length, 3);
  assert.deepEqual(templates[0].parameterGroups, [{ type: "body", count: 2 }]);
  assert.equal(templates[0].supported, true);
  assert.equal(templates[1].supported, false);
  assert.match(templates[1].unsupportedReason ?? "", /image header/);
  assert.equal(templates[2].supported, false);
  assert.match(templates[2].unsupportedReason ?? "", /dynamic button/);
});

test("sends a text-parameter template and returns its rendered transcript text", async () => {
  let sentBody: Record<string, unknown> = {};
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ messages: [{ id: "wamid.template-1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await sendWhatsAppTemplate(config, {
    to: "201001234567",
    template: {
      name: "appointment_reminder",
      language: "en_US",
      category: "UTILITY",
      preview: "Hello {{1}}, your appointment is {{2}}.",
      parameterGroups: [{ type: "body", count: 2 }],
      supported: true,
    },
    bodyParameters: ["Mona", "Monday at 5 PM"],
  }, fetcher);

  assert.deepEqual(sentBody, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "201001234567",
    type: "template",
    template: {
      name: "appointment_reminder",
      language: { code: "en_US" },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: "Mona" },
          { type: "text", text: "Monday at 5 PM" },
        ],
      }],
    },
  });
  assert.equal(result.renderedText, "Hello Mona, your appointment is Monday at 5 PM.");
});
