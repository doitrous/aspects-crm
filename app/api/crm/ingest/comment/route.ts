import { handleIngest } from "@/lib/ingest/meta/http";

/**
 * Facebook + Instagram comment ingestion, posted by n8n.
 *
 *     POST /api/crm/ingest/comment
 *     Authorization: Bearer <CRM_INGEST_API_KEY>   (or  x-api-key: …)
 *
 * Handles the whole comment lifecycle — created, updated, deleted — keyed on
 * `comment_id`. An edit rewrites the existing row and keeps the old text in the
 * audit history; a deletion marks the row deleted rather than removing it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return handleIngest(req, "comment");
}
