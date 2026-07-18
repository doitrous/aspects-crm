export const WEBSITE_CALLBACK_TAG = "Website - Callback";

export interface WebsiteCallbackPayload {
  callbackRequestId: string;
  patientName: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  patientEmail?: string;
  message?: string;
  language?: string;
  sourcePath?: string;
  createdAt?: string;
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

export function parseWebsiteCallbackPayload(value: unknown): WebsiteCallbackPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const callbackRequestId = optionalString(
    input.callbackRequestId ?? input.request_id,
    100,
  );
  const patientName = optionalString(input.patientName ?? input.name, 200);

  if (!callbackRequestId || !patientName) return null;

  return {
    callbackRequestId,
    patientName,
    phoneCountryCode: optionalString(
      input.phoneCountryCode ?? input.phone_country_code,
      10,
    ),
    phoneNumber: optionalString(input.phoneNumber ?? input.phone, 30),
    patientEmail: optionalString(input.patientEmail ?? input.email, 320),
    message: optionalString(input.message, 2_000),
    language: optionalString(input.language, 20),
    sourcePath: optionalString(input.sourcePath ?? input.source_path, 500),
    createdAt: optionalString(input.createdAt ?? input.created_at, 40),
  };
}

export function normalizeWebsiteCallbackPhone(
  countryCode?: string,
  phoneNumber?: string,
): string | null {
  const digits = `${countryCode ?? ""}${phoneNumber ?? ""}`.replace(/\D/g, "");
  return digits || null;
}
