import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchTrigger } from "@/lib/email/send";
import { secretsEqual } from "@/lib/security/secrets";

/**
 * Daily overdue-leads email (§E case 3). Intended to be hit by a scheduler at
 * 09:00 in the configured timezone (e.g. a Coolify cron or external pinger).
 *
 * Auth: shared secret in `CRON_SECRET`, sent as `Authorization: Bearer <key>`
 * or `?token=<key>`. Idempotency is handled by the rule's dedupe window, so a
 * scheduler that fires twice in the same morning only emails once.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TIMEZONE = process.env.CRM_TIMEZONE || "Africa/Cairo";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header?.startsWith("Bearer ") && secretsEqual(header.slice(7), secret)) return true;
  const url = new URL(req.url);
  return secretsEqual(url.searchParams.get("token"), secret);
}

/** Today's date (YYYY-MM-DD) in the configured timezone. */
function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { count } = await supabaseAdmin()
    .from("leads")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("is_reply_overdue", true);
  const overdueCount = count ?? 0;
  const reportDate = localDate();

  const outcome = await dispatchTrigger("overdue_leads_daily", {
    discriminator: reportDate,
    ctx: { overdue_count: overdueCount, report_date: reportDate },
  });

  return NextResponse.json({ ok: true, overdueCount, reportDate, outcome });
}

// Allow GET for simple schedulers that only issue GET requests.
export const GET = POST;
