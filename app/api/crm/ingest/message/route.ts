import { handleIngest } from "@/lib/ingest/meta/http";

/**
 * Facebook Messenger + Instagram DM ingestion, posted by n8n.
 *
 *     POST /api/crm/ingest/message
 *     Authorization: Bearer <CRM_INGEST_API_KEY>   (or  x-api-key: …)
 *
 * Accepts one record, an array of records, a `{records:[…]}` envelope, or a raw
 * Meta webhook envelope. Retries are safe: a replayed body inserts nothing and
 * still returns 200.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleIngest(req, "message");
}
