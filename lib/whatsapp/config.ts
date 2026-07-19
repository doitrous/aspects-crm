import "server-only";

import type { WhatsAppCloudConfig } from "@/lib/whatsapp/cloud";

const DEFAULT_GRAPH_API_VERSION = "v25.0";

function graphApiVersion(): string {
  const configured = process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(configured)) {
    throw new Error("WHATSAPP_GRAPH_API_VERSION must look like v25.0.");
  }
  return configured;
}

export function whatsappCloudConfig(): WhatsAppCloudConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) return null;

  return {
    accessToken,
    phoneNumberId,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || undefined,
    graphApiVersion: graphApiVersion(),
  };
}

export function whatsappConfigured(): boolean {
  return whatsappCloudConfig() !== null;
}

export function whatsappIngestSecret(): string | null {
  return process.env.WHATSAPP_INGEST_API_KEY || process.env.CRM_INGEST_API_KEY || null;
}
