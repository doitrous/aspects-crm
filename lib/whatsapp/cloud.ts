export const WHATSAPP_TEXT_LIMIT = 4_096;
export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type WhatsAppCloudConfig = {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId?: string;
  graphApiVersion: string;
};

export type WhatsAppTemplateParameterGroup = {
  type: "header" | "body";
  count: number;
};

export type WhatsAppTemplateSummary = {
  name: string;
  language: string;
  category?: string;
  preview: string;
  parameterGroups: WhatsAppTemplateParameterGroup[];
  supported: boolean;
  unsupportedReason?: string;
};

export type SendWhatsAppResult = {
  messageId: string;
  recipientId?: string;
  raw: Record<string, unknown>;
};

type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

export class WhatsAppCloudApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly subcode?: number;

  constructor(message: string, options: { status: number; code?: number; subcode?: number }) {
    super(message);
    this.name = "WhatsAppCloudApiError";
    this.status = options.status;
    this.code = options.code;
    this.subcode = options.subcode;
  }
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function whatsappRecipient(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function isInsideWhatsAppServiceWindow(lastIncomingAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastIncomingAt) return false;
  const at = new Date(lastIncomingAt).getTime();
  return Number.isFinite(at) && at <= now && now - at < WHATSAPP_SERVICE_WINDOW_MS;
}

function placeholderCount(value: string): number {
  const numbers = [...value.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  return numbers.length ? Math.max(...numbers) : 0;
}

function renderTemplateText(value: string, parameters: string[]): string {
  return value.replace(/\{\{(\d+)\}\}/g, (_match, number: string) => parameters[Number(number) - 1] ?? `{{${number}}}`);
}

async function responseJson(response: Response): Promise<JsonRecord> {
  return record(await response.json().catch(() => ({})));
}

function apiError(response: Response, payload: JsonRecord): WhatsAppCloudApiError {
  const error = record(payload.error);
  const data = record(error.error_data);
  const message = text(error.message) || text(data.details) || `Meta returned HTTP ${response.status}.`;
  return new WhatsAppCloudApiError(message, {
    status: response.status,
    code: typeof error.code === "number" ? error.code : undefined,
    subcode: typeof error.error_subcode === "number" ? error.error_subcode : undefined,
  });
}

function endpoint(config: WhatsAppCloudConfig, objectId: string, edge: string): string {
  return `https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(objectId)}/${edge}`;
}

async function postMessage(
  config: WhatsAppCloudConfig,
  payload: JsonRecord,
  fetcher: Fetcher,
): Promise<SendWhatsAppResult> {
  const response = await fetcher(endpoint(config, config.phoneNumberId, "messages"), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await responseJson(response);
  if (!response.ok) throw apiError(response, body);

  const messages = Array.isArray(body.messages) ? body.messages.map(record) : [];
  const contacts = Array.isArray(body.contacts) ? body.contacts.map(record) : [];
  const messageId = text(messages[0]?.id);
  if (!messageId) {
    throw new WhatsAppCloudApiError("Meta accepted the request without returning a WhatsApp message ID.", {
      status: response.status,
    });
  }

  return {
    messageId,
    recipientId: text(contacts[0]?.wa_id) || undefined,
    raw: body,
  };
}

export async function sendWhatsAppText(
  config: WhatsAppCloudConfig,
  input: { to: string; body: string },
  fetcher: Fetcher = fetch,
): Promise<SendWhatsAppResult> {
  const to = whatsappRecipient(input.to);
  const body = input.body.trim();
  if (!to) throw new Error("The lead does not have a valid international WhatsApp number.");
  if (!body) throw new Error("Write a message before sending.");
  if (body.length > WHATSAPP_TEXT_LIMIT) throw new Error(`WhatsApp messages cannot exceed ${WHATSAPP_TEXT_LIMIT} characters.`);

  return postMessage(config, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  }, fetcher);
}

export async function listApprovedWhatsAppTemplates(
  config: WhatsAppCloudConfig,
  fetcher: Fetcher = fetch,
): Promise<WhatsAppTemplateSummary[]> {
  if (!config.businessAccountId) return [];
  const url = new URL(endpoint(config, config.businessAccountId, "message_templates"));
  url.searchParams.set("fields", "name,status,language,category,components");
  url.searchParams.set("status", "APPROVED");
  url.searchParams.set("limit", "250");
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${config.accessToken}` },
    cache: "no-store",
  });
  const body = await responseJson(response);
  if (!response.ok) throw apiError(response, body);

  const rows = Array.isArray(body.data) ? body.data.map(record) : [];
  return rows.map((row) => {
    const components = Array.isArray(row.components) ? row.components.map(record) : [];
    const header = components.find((component) => text(component.type).toUpperCase() === "HEADER");
    const bodyComponent = components.find((component) => text(component.type).toUpperCase() === "BODY");
    const buttonComponent = components.find((component) => text(component.type).toUpperCase() === "BUTTONS");
    const headerFormat = text(header?.format).toUpperCase();
    const unsupportedHeader = Boolean(header && headerFormat && headerFormat !== "TEXT");
    const unsupportedDynamicButton = JSON.stringify(buttonComponent ?? {}).includes("{{");
    const headerText = text(header?.text);
    const bodyText = text(bodyComponent?.text);
    const headerCount = placeholderCount(headerText);
    const bodyCount = placeholderCount(bodyText);
    const groups: WhatsAppTemplateParameterGroup[] = [];
    if (headerCount) groups.push({ type: "header", count: headerCount });
    if (bodyCount) groups.push({ type: "body", count: bodyCount });
    return {
      name: text(row.name),
      language: text(row.language),
      category: text(row.category) || undefined,
      preview: [headerText, bodyText].filter(Boolean).join("\n"),
      parameterGroups: groups,
      supported: !unsupportedHeader && !unsupportedDynamicButton,
      unsupportedReason: unsupportedHeader
        ? `This template uses a ${headerFormat.toLowerCase()} header, which is not available in the CRM composer yet.`
        : unsupportedDynamicButton
          ? "This template has a dynamic button, which is not available in the CRM composer yet."
          : undefined,
    };
  }).filter((template) => template.name && template.language);
}

export async function sendWhatsAppTemplate(
  config: WhatsAppCloudConfig,
  input: {
    to: string;
    template: WhatsAppTemplateSummary;
    headerParameters?: string[];
    bodyParameters?: string[];
  },
  fetcher: Fetcher = fetch,
): Promise<SendWhatsAppResult & { renderedText: string }> {
  const to = whatsappRecipient(input.to);
  if (!to) throw new Error("The lead does not have a valid international WhatsApp number.");
  if (!input.template.supported) throw new Error(input.template.unsupportedReason || "This template is not supported by the CRM composer.");

  const supplied = {
    header: (input.headerParameters ?? []).map((value) => value.trim()),
    body: (input.bodyParameters ?? []).map((value) => value.trim()),
  };
  for (const group of input.template.parameterGroups) {
    if (supplied[group.type].length !== group.count || supplied[group.type].some((value) => !value)) {
      throw new Error(`Template ${group.type} requires ${group.count} value${group.count === 1 ? "" : "s"}.`);
    }
  }

  const components = input.template.parameterGroups.map((group) => ({
    type: group.type,
    parameters: supplied[group.type].map((value) => ({ type: "text", text: value })),
  }));
  const sent = await postMessage(config, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: input.template.name,
      language: { code: input.template.language },
      ...(components.length ? { components } : {}),
    },
  }, fetcher);

  const lines = input.template.preview.split("\n");
  const renderedText = lines.map((line, index) => renderTemplateText(
    line,
    index === 0 && input.template.parameterGroups.some((group) => group.type === "header") ? supplied.header : supplied.body,
  )).join("\n").trim() || `[Template: ${input.template.name}]`;
  return { ...sent, renderedText };
}
