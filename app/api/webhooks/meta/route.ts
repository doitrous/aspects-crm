import { handleIngest, handleVerify } from "@/lib/ingest/meta/http";

/**
 * Meta's own webhook URL — the one you register in the App Dashboard.
 *
 * `GET` answers the subscription challenge; `POST` takes both messages and
 * comments in a single stream, because Meta does not separate them. n8n uses
 * the dedicated `/api/crm/ingest/{message,comment}` routes instead; all three
 * share one handler.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  return handleVerify(req);
}

export async function POST(req: Request) {
  return handleIngest(req);
}
