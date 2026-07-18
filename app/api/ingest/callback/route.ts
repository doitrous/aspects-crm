import { NextResponse } from "next/server";
import {
  normalizeWebsiteCallbackPhone,
  parseWebsiteCallbackPayload,
  WEBSITE_CALLBACK_TAG,
} from "@/lib/ingest/callback";
import { phoneDuplicateKey } from "@/lib/phoneMatching";
import { secretsEqual } from "@/lib/security/secrets";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 64_000;
const CALLBACK_TAG_COLOR = "#0f766e";

function presentedKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-api-key");
  return x ? x.trim() : null;
}

async function nextLeadCode(db: ReturnType<typeof supabaseAdmin>): Promise<string> {
  const { data: generated, error: generateError } = await db.rpc("crm_generate_lead_id");
  if (!generateError && generated) return String(generated);

  const { data } = await db
    .from("leads")
    .select("lead_id")
    .order("lead_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const last = data?.lead_id as string | undefined;
  const n = last && /^L\d+$/.test(last) ? Number(last.slice(1)) + 1 : 1;
  return `L${String(n).padStart(4, "0")}`;
}

export async function POST(req: Request) {
  const expected = process.env.CRM_INGEST_API_KEY;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "ingest_not_configured" }, { status: 503 });
  }
  if (!secretsEqual(presentedKey(req), expected)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }

  let raw: unknown;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    }
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const body = parseWebsiteCallbackPayload(raw);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: "invalid_payload", need: ["request_id", "name"] },
      { status: 422 },
    );
  }

  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const normalizedPhone = normalizeWebsiteCallbackPhone(
    body.phoneCountryCode,
    body.phoneNumber,
  );
  const matchablePhone = phoneDuplicateKey(normalizedPhone);
  const channelMeta = {
    channel: "website_callback",
    callback_request_id: body.callbackRequestId,
    patient_email: body.patientEmail ?? null,
    callback_message: body.message ?? null,
    language: body.language ?? null,
    source_path: body.sourcePath ?? null,
    callback_requested_at: body.createdAt ?? now,
    ingested_at: now,
  };

  const { data: callbackTag, error: tagError } = await db
    .from("lead_tags")
    .upsert({
      name: WEBSITE_CALLBACK_TAG,
      color: CALLBACK_TAG_COLOR,
      is_active: true,
      updated_at: now,
    }, { onConflict: "name" })
    .select("id")
    .single();
  if (tagError || !callbackTag?.id) {
    console.error("Website callback tag preparation failed", { code: tagError?.code });
    return NextResponse.json({ ok: false, error: "tag_prepare_failed" }, { status: 500 });
  }

  type LeadMatch = {
    id: string;
    lead_id: string;
    metadata: Record<string, unknown> | null;
  };

  let matchedLead: LeadMatch | null = null;
  let action: "updated" | "linked" | "created" = "created";

  const { data: byRequestId } = await db
    .from("leads")
    .select("id,lead_id,metadata")
    .contains("metadata", { callback_request_id: body.callbackRequestId })
    .limit(1)
    .maybeSingle();
  if (byRequestId) {
    matchedLead = {
      id: String(byRequestId.id),
      lead_id: String(byRequestId.lead_id),
      metadata: (byRequestId.metadata as Record<string, unknown> | null) ?? null,
    };
    action = "updated";
  }

  if (!matchedLead && matchablePhone) {
    let phoneQuery = db
      .from("leads")
      .select("id,lead_id,metadata")
      .is("merged_into_lead_id", null)
      .order("created_at", { ascending: false })
      .limit(1);
    phoneQuery = matchablePhone.length >= 7
      ? phoneQuery.ilike("normalized_phone", `%${matchablePhone}`)
      : phoneQuery.eq("normalized_phone", matchablePhone);
    const { data: byPhone } = await phoneQuery.maybeSingle();
    if (byPhone) {
      matchedLead = {
        id: String(byPhone.id),
        lead_id: String(byPhone.lead_id),
        metadata: (byPhone.metadata as Record<string, unknown> | null) ?? null,
      };
      action = "linked";
    }
  }

  if (matchedLead) {
    const { error: updateError } = await db
      .from("leads")
      .update({
        status: "new_lead",
        has_unread: true,
        unread_since: now,
        last_incoming_at: now,
        metadata: { ...(matchedLead.metadata ?? {}), ...channelMeta },
        updated_at: now,
      })
      .eq("id", matchedLead.id);
    if (updateError) {
      console.error("Website callback lead update failed", { code: updateError.code });
      return NextResponse.json({ ok: false, error: "lead_update_failed" }, { status: 500 });
    }
  } else {
    const leadCode = await nextLeadCode(db);
    const { data: created, error: insertError } = await db
      .from("leads")
      .insert({
        lead_id: leadCode,
        name: body.patientName,
        status: "new_lead",
        platform: "manual",
        phone_country_code: body.phoneCountryCode ?? null,
        phone_number: body.phoneNumber ?? null,
        normalized_phone: normalizedPhone,
        notes: body.message ?? null,
        escalation_status: "none",
        has_unread: true,
        unread_since: now,
        unread_message_count: 1,
        last_incoming_at: now,
        first_contact_at: body.createdAt ?? now,
        metadata: channelMeta,
        created_at: now,
        updated_at: now,
      })
      .select("id,lead_id")
      .single();
    if (insertError || !created) {
      console.error("Website callback lead insert failed", { code: insertError?.code });
      return NextResponse.json({ ok: false, error: "insert_failed" }, { status: 500 });
    }
    matchedLead = {
      id: String(created.id),
      lead_id: String(created.lead_id),
      metadata: channelMeta,
    };
  }

  const { error: assignmentError } = await db
    .from("lead_tag_assignments")
    .upsert({
      lead_id: matchedLead.id,
      tag_id: callbackTag.id,
      assigned_by: null,
    }, { onConflict: "lead_id,tag_id" });
  if (assignmentError) {
    console.error("Website callback tag assignment failed", { code: assignmentError.code });
    return NextResponse.json({ ok: false, error: "tag_assignment_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action,
    leadId: matchedLead.id,
    leadCode: matchedLead.lead_id,
    tag: WEBSITE_CALLBACK_TAG,
  });
}
