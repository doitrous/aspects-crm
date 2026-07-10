import "server-only";

export function whatsappConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
      (process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID),
  );
}

export function whatsappIngestSecret(): string | null {
  return process.env.WHATSAPP_INGEST_API_KEY || process.env.CRM_INGEST_API_KEY || null;
}
