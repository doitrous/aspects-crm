import { NextResponse } from "next/server";
import { purgeExpiredLeadTrash } from "@/lib/data/leadTrash";
import { secretsEqual } from "@/lib/security/secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (header?.startsWith("Bearer ") && secretsEqual(header.slice(7), secret)) return true;
  return secretsEqual(new URL(request.url).searchParams.get("token"), secret);
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const purged = await purgeExpiredLeadTrash();
    return NextResponse.json({ ok: true, purged });
  } catch (error) {
    console.error("lead trash purge failed", error);
    return NextResponse.json({ ok: false, error: "purge_failed" }, { status: 500 });
  }
}

export const GET = POST;
