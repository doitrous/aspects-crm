import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { nestComments } from "@/lib/data/comments";
import type {
  AuditReport,
  Booking,
  Comment,
  CrmSetting,
  DuplicateDecision,
  DuplicateGroup,
  DuplicatePair,
  DuplicateStatus,
  Escalation,
  EscalationQueueItem,
  EscalationSeverity,
  EscalationStatus,
  FollowUpItem,
  Lead,
  LeadAttribution,
  LeadNote,
  LeadSourceInfo,
  LeadSummary,
  Message,
  MessageAttachment,
  MessageChannel,
  MessageReaction,
  Platform,
  PipelineStage,
  SummaryReport,
  TimelineEvent,
} from "@/lib/types";
import type {
  DashboardMetrics,
  DataProvider,
  LeadFilters,
} from "@/lib/data/contracts";

/* ── enum / value translation (DB ⇆ UI view model) ───────────── */

const DB_TO_UI_STAGE: Record<string, PipelineStage> = {
  new_lead: "new",
  qualified: "qualified",
  booked: "booked",
  follow_up: "follow_up",
  post_op_follow_up: "post_op",
  lost: "lost",
};

const UI_TO_DB_STAGE: Record<PipelineStage, string> = {
  new: "new_lead",
  qualified: "qualified",
  booked: "booked",
  follow_up: "follow_up",
  post_op: "post_op_follow_up",
  lost: "lost",
};

function toUiStage(status: string | null): PipelineStage {
  return (status && DB_TO_UI_STAGE[status]) || "new";
}

function toUiPlatform(platform: string | null): Platform {
  switch (platform) {
    case "facebook_messenger":
    case "facebook":
      return "facebook";
    case "instagram":
      return "instagram";
    case "whatsapp":
      return "whatsapp";
    default:
      return "web";
  }
}

/** The toolbar sends UI platform keys; translate to the DB's stored values. */
function toDbPlatform(uiPlatform: string): string {
  return uiPlatform === "facebook" ? "facebook_messenger" : uiPlatform;
}

function toUiChannel(platform: string | null): MessageChannel {
  switch (platform) {
    case "facebook_messenger":
    case "facebook":
      return "facebook";
    case "instagram":
      return "instagram";
    case "whatsapp":
      return "whatsapp";
    default:
      return "facebook";
  }
}

const ESCALATED_STATES = ["escalated", "in_review"];

/**
 * Operator credited with review actions until real auth is wired. This is the
 * live project's single owner_admin (crm_users). Replace with the session user
 * once authentication lands.
 */
const CURRENT_USER_ID = "8fef1be8-04a2-40b2-b231-cbb69cf900ba";

function toUiEscalationStatus(status: string | null): EscalationStatus {
  switch (status) {
    case "in_review":
      return "assigned";
    case "resolved":
      return "resolved";
    default:
      return "open";
  }
}

function toUiSeverity(severity: string | null): EscalationSeverity {
  return severity === "low" || severity === "medium" || severity === "high" || severity === "critical"
    ? severity
    : "medium";
}

function toUiDuplicateStatus(status: string | null): DuplicateStatus {
  switch (status) {
    case "merged":
      return "merged";
    case "dismissed":
    case "not_duplicate":
      return "not_duplicate";
    default:
      return "suspected";
  }
}

/* ── row shapes (only the columns we read) ───────────────────── */

interface LeadRow {
  id: string;
  lead_id: string;
  mrn: string | null;
  name: string | null;
  status: string | null;
  platform: string | null;
  platform_id: string | null;
  chat_link: string | null;
  gender: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  normalized_phone: string | null;
  source_id: string | null;
  service_name: string | null;
  doctor_id: string | null;
  branch_id: string | null;
  coordinator_user_id: string | null;
  escalation_status: string | null;
  has_unread: boolean;
  is_reply_overdue: boolean;
  booking_appointment_id: string | null;
  lost_reason_id: string | null;
  notes: string | null;
  medical_notes: string | null;
  medical_history: string | null;
  ai_summary: string | null;
  last_incoming_at: string | null;
  last_outgoing_at: string | null;
  last_contact_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * A PostgREST row. The Supabase client is untyped here (no generated Database
 * types), and its `.select()` overload only infers a shape from a *literal*
 * column string — a concatenated one degrades to `GenericStringError`. We read
 * rows through this alias instead and narrow each column at the use site.
 */
type Row = Record<string, unknown>;

const LEAD_COLUMNS =
  "id,lead_id,mrn,name,status,platform,platform_id,chat_link,gender," +
  "phone_country_code,phone_number,normalized_phone,source_id,service_name," +
  "doctor_id,branch_id,coordinator_user_id,escalation_status,has_unread," +
  "is_reply_overdue,booking_appointment_id,lost_reason_id,notes,medical_notes," +
  "medical_history,ai_summary,last_incoming_at,last_outgoing_at,last_contact_at," +
  "created_at,updated_at";

interface Lookups {
  usersById: Map<string, string>; // crm_users.id -> full_name
  lostReasonsById: Map<string, string>;
  dupSet: Set<string>; // lead uuids that appear in any duplicate flag
}

/* ── shared lookups ──────────────────────────────────────────── */

async function loadUserMap(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin().from("crm_users").select("id,full_name,email");
  const map = new Map<string, string>();
  for (const u of data ?? []) {
    map.set(u.id as string, ((u.full_name as string) || (u.email as string) || "—").trim());
  }
  return map;
}

async function loadLostReasonMap(): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin().from("lost_reasons").select("id,label");
  const map = new Map<string, string>();
  for (const r of data ?? []) map.set(r.id as string, r.label as string);
  return map;
}

async function loadDuplicateSet(): Promise<Set<string>> {
  const { data } = await supabaseAdmin()
    .from("lead_duplicate_flags")
    .select("lead_id,duplicate_lead_id,status");
  const set = new Set<string>();
  for (const f of data ?? []) {
    if (f.status === "merged" || f.status === "dismissed" || f.status === "not_duplicate") continue;
    if (f.lead_id) set.add(f.lead_id as string);
    if (f.duplicate_lead_id) set.add(f.duplicate_lead_id as string);
  }
  return set;
}

/* ── mappers ─────────────────────────────────────────────────── */

function buildPhone(row: LeadRow): string {
  const cc = row.phone_country_code?.trim();
  const num = row.phone_number?.trim();
  if (num) return cc ? `${cc} ${num}` : num;
  return row.normalized_phone ?? "";
}

function buildNote(row: LeadRow): LeadNote {
  return {
    clientNotes: row.notes ?? "",
    medicalHistory: row.medical_history ?? "",
    generalNotes: row.medical_notes ?? "",
    updatedAt: row.updated_at,
  };
}

function mapLead(row: LeadRow, lk: Lookups): Lead {
  const gender = row.gender === "male" || row.gender === "female" ? row.gender : undefined;
  const lastMessageAt =
    row.last_incoming_at ?? row.last_outgoing_at ?? row.last_contact_at ?? row.updated_at;
  return {
    id: row.lead_id,
    uid: row.id,
    mrn: row.mrn ?? undefined,
    patientName: row.name?.trim() || "Unnamed lead",
    phone: buildPhone(row),
    gender,
    platform: toUiPlatform(row.platform),
    platformId: row.platform_id ?? undefined,
    chatLink: row.chat_link ?? undefined,
    sourceId: row.source_id ?? undefined,
    specialtyId: undefined,
    serviceName: row.service_name ?? undefined,
    doctorId: row.doctor_id ?? undefined,
    doctorName: undefined,
    branch: undefined,
    patientType: "new",
    stage: toUiStage(row.status),
    stageHistory: [],
    assignedModerator: row.coordinator_user_id
      ? lk.usersById.get(row.coordinator_user_id)
      : undefined,
    tags: [],
    unread: row.has_unread,
    incomingUnanswered: row.has_unread,
    overdue: row.is_reply_overdue,
    escalated: ESCALATED_STATES.includes(row.escalation_status ?? "none"),
    duplicateStatus: lk.dupSet.has(row.id) ? "suspected" : "none",
    lastMessage: row.ai_summary ?? undefined,
    lastMessageAt,
    createdAt: row.created_at,
    lostReason: row.lost_reason_id ? lk.lostReasonsById.get(row.lost_reason_id) : undefined,
    bookingStatus: row.booking_appointment_id ? "unconfirmed" : "none",
    note: buildNote(row),
    followUp: { status: "none" },
  };
}

/* ── compact lead summaries (queue rows) ─────────────────────── */

interface SummaryRow {
  id: string;
  lead_id: string;
  name: string | null;
  status: string | null;
  platform: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  normalized_phone: string | null;
  service_name: string | null;
  coordinator_user_id: string | null;
  created_at: string;
  last_contact_at?: string | null;
}

const SUMMARY_COLUMNS =
  "id,lead_id,name,status,platform,phone_country_code,phone_number," +
  "normalized_phone,service_name,coordinator_user_id,created_at,last_contact_at";

function rowToSummary(r: SummaryRow, usersById: Map<string, string>): LeadSummary {
  return {
    id: r.lead_id,
    uid: r.id,
    name: r.name?.trim() || "Unnamed lead",
    phone: buildPhone(r as unknown as LeadRow),
    stage: toUiStage(r.status),
    platform: toUiPlatform(r.platform),
    createdAt: r.created_at,
    serviceName: r.service_name ?? undefined,
    assignedModerator: r.coordinator_user_id
      ? usersById.get(r.coordinator_user_id)
      : undefined,
  };
}

/** Fetch compact summaries for a set of lead uuids, keyed by uuid. */
async function loadLeadSummaries(
  uuids: string[],
  usersById: Map<string, string>,
): Promise<Map<string, LeadSummary>> {
  const map = new Map<string, LeadSummary>();
  if (uuids.length === 0) return map;
  const { data } = await supabaseAdmin()
    .from("leads")
    .select(SUMMARY_COLUMNS)
    .in("id", uuids);
  for (const r of (data as unknown as SummaryRow[]) ?? []) {
    map.set(r.id, rowToSummary(r, usersById));
  }
  return map;
}

/** UTC calendar helpers for the previous-day auditor model. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function previousDay(d: Date): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - 1);
  return x;
}

/** Resolve a human lead_id (e.g. "L0001") to the row's uuid primary key. */
async function resolveUid(leadId: string): Promise<string | undefined> {
  const { data } = await supabaseAdmin()
    .from("leads")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();
  return (data?.id as string) ?? undefined;
}

/* ── provider ────────────────────────────────────────────────── */

export const supabaseProvider: DataProvider = {
  now: () => new Date(),

  async getLeads(filters: LeadFilters = {}): Promise<Lead[]> {
    const [usersById, lostReasonsById, dupSet] = await Promise.all([
      loadUserMap(),
      loadLostReasonMap(),
      loadDuplicateSet(),
    ]);

    let query = supabaseAdmin().from("leads").select(LEAD_COLUMNS);

    if (filters.stage && filters.stage !== "all") {
      query = query.eq("status", UI_TO_DB_STAGE[filters.stage]);
    }
    if (filters.platform) query = query.eq("platform", toDbPlatform(filters.platform));
    if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
    if (filters.doctorId) query = query.eq("doctor_id", filters.doctorId);
    if (filters.unread) query = query.eq("has_unread", true);
    if (filters.incomingUnanswered) query = query.eq("has_unread", true);
    if (filters.overdue) query = query.eq("is_reply_overdue", true);
    if (filters.escalated) query = query.in("escalation_status", ESCALATED_STATES);
    if (filters.duplicate) {
      const ids = [...dupSet];
      query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
    if (filters.q) {
      const term = filters.q.replace(/[%,()]/g, " ").trim();
      const like = `%${term}%`;
      query = query.or(
        [
          `lead_id.ilike.${like}`,
          `name.ilike.${like}`,
          `mrn.ilike.${like}`,
          `normalized_phone.ilike.${like}`,
          `phone_number.ilike.${like}`,
          `platform_id.ilike.${like}`,
          `chat_link.ilike.${like}`,
        ].join(","),
      );
    }

    query = query.order("updated_at", { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error(`getLeads: ${error.message}`);
    return (data as unknown as LeadRow[]).map((r) => mapLead(r, { usersById, lostReasonsById, dupSet }));
  },

  async getLead(id: string): Promise<Lead | undefined> {
    const [usersById, lostReasonsById, dupSet] = await Promise.all([
      loadUserMap(),
      loadLostReasonMap(),
      loadDuplicateSet(),
    ]);
    const { data, error } = await supabaseAdmin()
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("lead_id", id)
      .maybeSingle();
    if (error) throw new Error(`getLead: ${error.message}`);
    if (!data) return undefined;
    return mapLead(data as unknown as LeadRow, { usersById, lostReasonsById, dupSet });
  },

  async messagesFor(leadId: string, channels?: MessageChannel[]): Promise<Message[]> {
    const uid = await resolveUid(leadId);
    if (!uid) return [];
    const db = supabaseAdmin();

    // `is_conversation_content` is the gate that keeps delivery receipts, read
    // receipts, reactions and referrals out of the chat thread. Those live in
    // `crm_conversation_events` and are rendered as timeline cards, not bubbles.
    const { data, error } = await db
      .from("crm_messages")
      .select(
        "id,platform,direction,message_text,sent_by_name,message_at,platform_message_id,message_type," +
          "attachment_count,quick_reply_text,postback_title,reply_to_message_id,reply_to," +
          "edit_count,edited_at,delivery_status,delivered_at,seen_at," +
          "message_is_deleted,message_is_unsupported",
      )
      .eq("lead_id", uid)
      .eq("is_conversation_content", true)
      .order("message_at", { ascending: true });
    if (error) throw new Error(`messagesFor: ${error.message}`);

    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) return [];

    const ids = rows.map((m) => m.id as string);
    const platformIds = rows.map((m) => m.platform_message_id as string | null).filter((v): v is string => Boolean(v));

    const [attachments, reactions] = await Promise.all([
      rows.some((m) => ((m.attachment_count as number | null) ?? 0) > 0)
        ? db
            .from("crm_message_attachments")
            .select("id,message_id,attachment_index,type,raw_type,url,title,name,sticker_id")
            .in("message_id", ids)
            .order("attachment_index", { ascending: true })
        : Promise.resolve({ data: [] as Row[] }),
      platformIds.length
        ? db
            .from("crm_message_reactions")
            .select("id,target_message_id,reaction_emoji,reaction_type,actor_platform_user_id,reacted_at")
            .in("target_message_id", platformIds)
            .eq("is_active", true)
            .order("reacted_at", { ascending: true })
        : Promise.resolve({ data: [] as Row[] }),
    ]);

    const attByMessage = new Map<string, MessageAttachment[]>();
    for (const a of (attachments.data ?? []) as unknown as Row[]) {
      const key = a.message_id as string;
      const list = attByMessage.get(key) ?? [];
      list.push({
        id: a.id as string,
        index: (a.attachment_index as number) ?? 0,
        type: (a.type as string) ?? "unknown",
        rawType: (a.raw_type as string) ?? undefined,
        url: (a.url as string) ?? undefined,
        title: (a.title as string) ?? undefined,
        name: (a.name as string) ?? undefined,
        stickerId: (a.sticker_id as string) ?? undefined,
      });
      attByMessage.set(key, list);
    }

    // Reactions are keyed by the PLATFORM message id, because a reaction can
    // arrive before the message it targets has been ingested.
    const rxnByPlatformId = new Map<string, MessageReaction[]>();
    for (const r of (reactions.data ?? []) as unknown as Row[]) {
      const key = r.target_message_id as string;
      const list = rxnByPlatformId.get(key) ?? [];
      list.push({
        id: r.id as string,
        emoji: (r.reaction_emoji as string) ?? undefined,
        type: (r.reaction_type as string) ?? undefined,
        actorName: (r.actor_platform_user_id as string) ?? undefined,
        reactedAt: r.reacted_at as string,
      });
      rxnByPlatformId.set(key, list);
    }

    const byPlatformId = new Map<string, Row>();
    for (const m of rows) {
      const pid = m.platform_message_id as string | null;
      if (pid) byPlatformId.set(pid, m);
    }

    const out: Message[] = rows.map((m) => {
      const pid = m.platform_message_id as string | null;
      const replyToId = m.reply_to_message_id as string | null;
      const original = replyToId ? byPlatformId.get(replyToId) : undefined;
      const replyToRaw = (m.reply_to ?? null) as { message_text?: string; sender_name?: string } | null;

      return {
        id: m.id as string,
        leadId,
        channel: toUiChannel(m.platform as string),
        direction: m.direction === "outgoing" ? "outgoing" : "incoming",
        body: (m.message_text as string) ?? "",
        createdAt: m.message_at as string,
        authorName: (m.sent_by_name as string) ?? undefined,
        platformMessageId: pid ?? undefined,
        messageType: (m.message_type as string) ?? undefined,
        attachments: attByMessage.get(m.id as string),
        reactions: pid ? rxnByPlatformId.get(pid) : undefined,
        replyTo: replyToId
          ? {
              messageId: replyToId,
              localId: original ? (original.id as string) : undefined,
              // Prefer our own copy of the original; fall back to the snapshot
              // Meta sent, which is all we have when the original predates us.
              body: original ? ((original.message_text as string) ?? undefined) : replyToRaw?.message_text,
              authorName: original ? ((original.sent_by_name as string) ?? undefined) : replyToRaw?.sender_name,
            }
          : undefined,
        editCount: (m.edit_count as number | null) ?? 0,
        editedAt: (m.edited_at as string) ?? undefined,
        deliveryStatus: (m.delivery_status as Message["deliveryStatus"]) ?? undefined,
        deliveredAt: (m.delivered_at as string) ?? undefined,
        seenAt: (m.seen_at as string) ?? undefined,
        quickReplyText: (m.quick_reply_text as string) ?? undefined,
        postbackTitle: (m.postback_title as string) ?? undefined,
        isDeleted: Boolean(m.message_is_deleted),
        isUnsupported: Boolean(m.message_is_unsupported),
      };
    });

    return channels ? out.filter((m) => channels.includes(m.channel)) : out;
  },

  async commentsFor(leadId: string): Promise<Comment[]> {
    const uid = await resolveUid(leadId);
    if (!uid) return [];
    const db = supabaseAdmin();

    const { data, error } = await db
      .from("crm_comments")
      .select(
        "id,platform,comment_id,parent_comment_id,thread_root_comment_id,thread_role,is_reply," +
          "is_page_or_business_reply,comment_text,comment_timestamp,commenter_name,commenter_username," +
          "identity_confidence,post_id,media_id,media_permalink,media_caption,media_type,media_product_type," +
          "comment_link,attachment_count,is_edited,is_deleted,edit_count",
      )
      .eq("lead_id", uid)
      .order("comment_timestamp", { ascending: true });
    if (error) throw new Error(`commentsFor: ${error.message}`);

    const rows = (data ?? []) as unknown as Row[];
    if (rows.length === 0) return [];

    const attachments = rows.some((c) => ((c.attachment_count as number | null) ?? 0) > 0)
      ? await db
          .from("crm_comment_attachments")
          .select("id,comment_id,attachment_index,type,raw_type,url,title,name,sticker_id")
          .in(
            "comment_id",
            rows.map((c) => c.id as string),
          )
          .order("attachment_index", { ascending: true })
      : { data: [] as Row[] };

    const attByComment = new Map<string, MessageAttachment[]>();
    for (const a of (attachments.data ?? []) as unknown as Row[]) {
      const key = a.comment_id as string;
      const list = attByComment.get(key) ?? [];
      list.push({
        id: a.id as string,
        index: (a.attachment_index as number) ?? 0,
        type: (a.type as string) ?? "unknown",
        rawType: (a.raw_type as string) ?? undefined,
        url: (a.url as string) ?? undefined,
        title: (a.title as string) ?? undefined,
        name: (a.name as string) ?? undefined,
        stickerId: (a.sticker_id as string) ?? undefined,
      });
      attByComment.set(key, list);
    }

    const flat: Comment[] = rows.map((c) => ({
      id: c.id as string,
      leadId,
      platform: c.platform === "instagram" ? "instagram" : "facebook",
      commentId: c.comment_id as string,
      parentCommentId: (c.parent_comment_id as string) ?? undefined,
      threadRootCommentId: (c.thread_root_comment_id as string) ?? undefined,
      threadRole: (c.thread_role as Comment["threadRole"]) ?? "top_level",
      isReply: Boolean(c.is_reply),
      isPageOrBusinessReply: Boolean(c.is_page_or_business_reply),
      body: (c.comment_text as string) ?? "",
      createdAt: c.comment_timestamp as string,
      authorName: (c.commenter_name as string) ?? undefined,
      authorUsername: (c.commenter_username as string) ?? undefined,
      identityConfidence: (c.identity_confidence as Comment["identityConfidence"]) ?? undefined,
      postId: (c.post_id as string) ?? undefined,
      mediaId: (c.media_id as string) ?? undefined,
      mediaPermalink: (c.media_permalink as string) ?? undefined,
      mediaCaption: (c.media_caption as string) ?? undefined,
      mediaType: (c.media_type as string) ?? undefined,
      mediaProductType: (c.media_product_type as string) ?? undefined,
      commentLink: (c.comment_link as string) ?? undefined,
      attachments: attByComment.get(c.id as string),
      isEdited: Boolean(c.is_edited),
      isDeleted: Boolean(c.is_deleted),
      editCount: (c.edit_count as number | null) ?? 0,
      replies: [],
    }));

    return nestComments(flat);
  },

  async attributionFor(leadId: string): Promise<LeadAttribution | null> {
    const uid = await resolveUid(leadId);
    if (!uid) return null;
    const { data, error } = await supabaseAdmin()
      .from("crm_lead_attribution")
      .select("*")
      .eq("lead_id", uid)
      .maybeSingle();
    if (error) throw new Error(`attributionFor: ${error.message}`);
    if (!data) return null;
    const row = data as unknown as Row;
    return {
      leadId,
      firstSource: (row.first_source as string) ?? undefined,
      firstCampaign: (row.first_campaign as string) ?? undefined,
      firstAdId: (row.first_ad_id as string) ?? undefined,
      firstAdName: (row.first_ad_name as string) ?? undefined,
      firstReferralSource: (row.first_referral_source as string) ?? undefined,
      firstReferralCode: (row.first_referral_code as string) ?? undefined,
      firstTouchAt: (row.first_touch_at as string) ?? undefined,
      latestSource: (row.latest_source as string) ?? undefined,
      latestCampaign: (row.latest_campaign as string) ?? undefined,
      latestAdId: (row.latest_ad_id as string) ?? undefined,
      latestAdName: (row.latest_ad_name as string) ?? undefined,
      latestReferralSource: (row.latest_referral_source as string) ?? undefined,
      latestTouchAt: (row.latest_touch_at as string) ?? undefined,
      touchCount: (row.touch_count as number | null) ?? 0,
    };
  },

  async bookingsFor(): Promise<Booking[]> {
    // Bookings live in the external booking system (adminaspectsclinica),
    // connected in a later phase. No local booking rows yet.
    return [];
  },

  async escalationsFor(leadId: string): Promise<Escalation[]> {
    const [uid, usersById] = await Promise.all([resolveUid(leadId), loadUserMap()]);
    if (!uid) return [];
    const { data, error } = await supabaseAdmin()
      .from("escalations")
      .select("*")
      .eq("lead_id", uid)
      .order("created_at", { ascending: false });
    if (error) throw new Error(`escalationsFor: ${error.message}`);
    return (data ?? []).map((e) => ({
      id: e.id as string,
      leadId,
      reason: (e.reason as string) ?? "Escalation",
      severity: toUiSeverity(e.severity as string),
      status: toUiEscalationStatus(e.status as string),
      createdAt: e.created_at as string,
      raisedBy: e.requested_by ? (usersById.get(e.requested_by as string) ?? "—") : "—",
      assignedTo: e.assigned_to ? usersById.get(e.assigned_to as string) : undefined,
      resolutionNote: (e.notes as string) ?? undefined,
      resolvedBy: e.resolved_by ? usersById.get(e.resolved_by as string) : undefined,
      resolvedAt: (e.resolved_at as string) ?? undefined,
    }));
  },

  async duplicatesFor(leadId: string): Promise<DuplicateGroup[]> {
    const uid = await resolveUid(leadId);
    if (!uid) return [];
    const { data, error } = await supabaseAdmin()
      .from("lead_duplicate_flags")
      .select("id,lead_id,duplicate_lead_id,duplicate_type,confidence_score,status")
      .or(`lead_id.eq.${uid},duplicate_lead_id.eq.${uid}`);
    if (error) throw new Error(`duplicatesFor: ${error.message}`);
    const flags = data ?? [];
    if (flags.length === 0) return [];

    // Resolve every referenced uuid to its human lead_id for display.
    const uuids = new Set<string>();
    for (const f of flags) {
      uuids.add(f.lead_id as string);
      uuids.add(f.duplicate_lead_id as string);
    }
    const { data: rows } = await supabaseAdmin()
      .from("leads")
      .select("id,lead_id")
      .in("id", [...uuids]);
    const humanById = new Map<string, string>();
    for (const r of rows ?? []) humanById.set(r.id as string, r.lead_id as string);

    return flags.map((f) => ({
      id: f.id as string,
      reason: (f.duplicate_type as string) ?? "Possible duplicate",
      confidence: typeof f.confidence_score === "number" ? (f.confidence_score as number) : 0.8,
      leadIds: [
        humanById.get(f.lead_id as string),
        humanById.get(f.duplicate_lead_id as string),
      ].filter((x): x is string => Boolean(x)),
      status: toUiDuplicateStatus(f.status as string),
    }));
  },

  async leadTimeline(leadId: string): Promise<TimelineEvent[]> {
    const uid = await resolveUid(leadId);
    if (!uid) return [];
    const [usersById, leadRow, events] = await Promise.all([
      loadUserMap(),
      supabaseAdmin().from("leads").select("created_at").eq("id", uid).maybeSingle(),
      supabaseAdmin()
        .from("lead_timeline_events")
        .select("id,event_type,title,actor_user_id,event_at")
        .eq("lead_id", uid)
        .order("event_at", { ascending: false }),
    ]);
    if (events.error) throw new Error(`leadTimeline: ${events.error.message}`);

    const kindOf = (t: string): TimelineEvent["kind"] => {
      // Checked before "create": `attribution_first_touch` must not read as a
      // lead-created event.
      if (t.includes("attribution") || t.includes("referral")) return "attribution";
      if (t.includes("create")) return "lead_created";
      if (t.includes("status") || t.includes("stage")) return "stage_change";
      if (t.includes("message")) return "message_in";
      if (t.includes("escalat")) return "escalation";
      if (t.includes("book")) return "booking";
      if (t.includes("duplicate")) return "duplicate_merge";
      if (t.includes("follow")) return "follow_up";
      return "note";
    };

    const out: TimelineEvent[] = (events.data ?? []).map((e) => ({
      id: e.id as string,
      leadId,
      at: e.event_at as string,
      kind: kindOf((e.event_type as string) ?? ""),
      label: (e.title as string) ?? "Event",
      actor: e.actor_user_id ? usersById.get(e.actor_user_id as string) : undefined,
    }));

    if (leadRow.data?.created_at) {
      out.push({
        id: `${uid}-created`,
        leadId,
        at: leadRow.data.created_at as string,
        kind: "lead_created",
        label: "Lead created",
      });
    }
    return out;
  },

  async dashboardMetrics(): Promise<DashboardMetrics> {
    const db = supabaseAdmin();
    const leadCount = () => db.from("leads").select("id", { count: "exact", head: true });
    const n = async (p: PromiseLike<{ count: number | null }>) => (await p).count ?? 0;

    const [newLeads, unread, overdue, qualified, followUp, booked, dupSet, escalations] =
      await Promise.all([
        n(leadCount().eq("status", "new_lead")),
        n(leadCount().eq("has_unread", true)),
        n(leadCount().eq("is_reply_overdue", true)),
        n(leadCount().eq("status", "qualified")),
        n(leadCount().eq("status", "follow_up")),
        n(leadCount().not("booking_appointment_id", "is", null)),
        loadDuplicateSet(),
        n(db.from("escalations").select("id", { count: "exact", head: true }).neq("status", "resolved")),
      ]);

    return {
      newLeads,
      unread,
      incomingUnanswered: unread,
      overdue,
      qualified,
      followUp,
      duplicates: dupSet.size,
      escalations,
      unconfirmedAppts: booked,
    };
  },

  async pipelineCounts(): Promise<Record<PipelineStage, number>> {
    const { data, error } = await supabaseAdmin().from("leads").select("status");
    if (error) throw new Error(`pipelineCounts: ${error.message}`);
    const base: Record<PipelineStage, number> = {
      new: 0,
      qualified: 0,
      booked: 0,
      follow_up: 0,
      post_op: 0,
      lost: 0,
    };
    for (const r of data ?? []) base[toUiStage(r.status as string)]++;
    return base;
  },

  async escalationQueue(): Promise<EscalationQueueItem[]> {
    const usersById = await loadUserMap();
    const { data, error } = await supabaseAdmin()
      .from("escalations")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`escalationQueue: ${error.message}`);
    const rows = data ?? [];
    const uuids = [...new Set(rows.map((e) => e.lead_id as string).filter(Boolean))];
    const summaries = await loadLeadSummaries(uuids, usersById);
    return rows.map((e) => {
      const lead = summaries.get(e.lead_id as string);
      return {
        id: e.id as string,
        leadId: lead?.id ?? "",
        reason: (e.reason as string) ?? "Escalation",
        severity: toUiSeverity(e.severity as string),
        status: toUiEscalationStatus(e.status as string),
        createdAt: e.created_at as string,
        raisedBy: e.requested_by ? (usersById.get(e.requested_by as string) ?? "—") : "—",
        assignedTo: e.assigned_to ? usersById.get(e.assigned_to as string) : undefined,
        resolutionNote: (e.notes as string) ?? undefined,
        resolvedBy: e.resolved_by ? usersById.get(e.resolved_by as string) : undefined,
        resolvedAt: (e.resolved_at as string) ?? undefined,
        lead,
      };
    });
  },

  async duplicateQueue(): Promise<DuplicatePair[]> {
    const usersById = await loadUserMap();
    const { data, error } = await supabaseAdmin()
      .from("lead_duplicate_flags")
      .select(
        "id,lead_id,duplicate_lead_id,duplicate_type,identifier_value,status,notes,reviewed_by,confidence_score,created_at",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(`duplicateQueue: ${error.message}`);
    const rows = data ?? [];
    const uuids = [
      ...new Set(
        rows
          .flatMap((f) => [f.lead_id as string, f.duplicate_lead_id as string])
          .filter(Boolean),
      ),
    ];
    const summaries = await loadLeadSummaries(uuids, usersById);
    return rows.map((f) => ({
      id: f.id as string,
      type: (f.duplicate_type as string) ?? "possible",
      confidence: typeof f.confidence_score === "number" ? (f.confidence_score as number) : 0.8,
      status: toUiDuplicateStatus(f.status as string),
      notes: (f.notes as string) ?? (f.identifier_value as string) ?? undefined,
      createdAt: f.created_at as string,
      reviewedBy: f.reviewed_by ? usersById.get(f.reviewed_by as string) : undefined,
      primary: summaries.get(f.lead_id as string),
      duplicate: summaries.get(f.duplicate_lead_id as string),
    }));
  },

  async followUpQueue(): Promise<FollowUpItem[]> {
    const usersById = await loadUserMap();
    const { data, error } = await supabaseAdmin()
      .from("leads")
      .select(SUMMARY_COLUMNS)
      .in("status", ["follow_up", "post_op_follow_up"])
      .order("updated_at", { ascending: false });
    if (error) throw new Error(`followUpQueue: ${error.message}`);
    const leadRows = (data as unknown as SummaryRow[]) ?? [];
    const uuids = leadRows.map((r) => r.id);

    // Attach each lead's earliest still-open follow-up stage, if any.
    const stageByLead = new Map<
      string,
      {
        workflow_type: string | null;
        stage_number: number | null;
        due_at: string | null;
        reason: string | null;
        status: string | null;
        last_contact_at: string | null;
      }
    >();
    if (uuids.length) {
      const { data: stages } = await supabaseAdmin()
        .from("lead_follow_up_stages")
        .select("lead_id,workflow_type,stage_number,due_at,reason,status,last_contact_at")
        .in("lead_id", uuids)
        .neq("status", "completed")
        .order("due_at", { ascending: true });
      for (const s of stages ?? []) {
        const key = s.lead_id as string;
        if (!stageByLead.has(key)) {
          stageByLead.set(key, {
            workflow_type: s.workflow_type as string | null,
            stage_number: s.stage_number as number | null,
            due_at: s.due_at as string | null,
            reason: s.reason as string | null,
            status: s.status as string | null,
            last_contact_at: s.last_contact_at as string | null,
          });
        }
      }
    }

    const now = Date.now();
    return leadRows.map((r) => {
      const s = stageByLead.get(r.id);
      const dueAt = s?.due_at ?? undefined;
      return {
        lead: rowToSummary(r, usersById),
        workflowType: s?.workflow_type ?? undefined,
        stageNumber: s?.stage_number ?? undefined,
        dueAt,
        reason: s?.reason ?? undefined,
        status: s?.status ?? "pending",
        lastContactAt: s?.last_contact_at ?? r.last_contact_at ?? undefined,
        overdue: dueAt ? new Date(dueAt).getTime() < now : false,
      };
    });
  },

  async auditorReport(date?: string): Promise<AuditReport | null> {
    const target = date ?? isoDay(previousDay(new Date()));
    const usersById = await loadUserMap();
    const { data, error } = await supabaseAdmin()
      .from("audit_daily_reports")
      .select("*")
      .eq("report_date", target)
      .maybeSingle();
    if (error) throw new Error(`auditorReport: ${error.message}`);
    if (!data) return null;

    const auto = (data.auto_metric_snapshot ?? {}) as Record<string, number>;
    const override = (data.override_metric_snapshot ?? {}) as Record<string, number>;
    return {
      date: data.report_date as string,
      status: (data.status as string) ?? "draft",
      notes: (data.notes as string) ?? undefined,
      submittedBy: data.submitted_by ? usersById.get(data.submitted_by as string) : undefined,
      approvedBy: data.approved_by ? usersById.get(data.approved_by as string) : undefined,
      metrics: { ...auto, ...override },
      overrides: Object.keys(override),
      oldLeadsDueNextDay: (data.old_leads_due_next_day as number) ?? undefined,
      auditedFollowupScore: (data.audited_followup_score as number) ?? undefined,
    };
  },

  async auditorReportDates(): Promise<string[]> {
    const { data, error } = await supabaseAdmin()
      .from("audit_daily_reports")
      .select("report_date")
      .order("report_date", { ascending: false });
    if (error) throw new Error(`auditorReportDates: ${error.message}`);
    return (data ?? []).map((r) => r.report_date as string);
  },

  async resolveDuplicate(
    flagId: string,
    decision: DuplicateDecision,
    notes?: string,
  ): Promise<void> {
    const db = supabaseAdmin();
    const nowIso = new Date().toISOString();
    // History-preserving: flip the flag's status and log the action; nothing
    // is deleted, so a decision can always be revisited.
    const { error } = await db
      .from("lead_duplicate_flags")
      .update({
        status: decision,
        reviewed_by: CURRENT_USER_ID,
        reviewed_at: nowIso,
        updated_at: nowIso,
        ...(notes ? { notes } : {}),
      })
      .eq("id", flagId);
    if (error) throw new Error(`resolveDuplicate: ${error.message}`);

    const { error: logError } = await db.from("duplicate_review_actions").insert({
      duplicate_flag_id: flagId,
      action: decision,
      action_by: CURRENT_USER_ID,
      notes: notes ?? null,
    });
    if (logError) throw new Error(`resolveDuplicate(log): ${logError.message}`);
  },

  async resolveEscalation(id: string, note?: string): Promise<void> {
    const db = supabaseAdmin();
    const nowIso = new Date().toISOString();
    const { error } = await db
      .from("escalations")
      .update({
        status: "resolved",
        resolved_by: CURRENT_USER_ID,
        resolved_at: nowIso,
        updated_at: nowIso,
        ...(note ? { notes: note } : {}),
      })
      .eq("id", id);
    if (error) throw new Error(`resolveEscalation: ${error.message}`);
  },

  async summaryReports(): Promise<SummaryReport[]> {
    const usersById = await loadUserMap();
    const { data, error } = await supabaseAdmin()
      .from("operational_summary_reports")
      .select("*")
      .order("report_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(`summaryReports: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      reportType: (r.report_type as string) ?? "report",
      reportDate: r.report_date as string,
      dateFrom: (r.date_from as string) ?? undefined,
      dateTo: (r.date_to as string) ?? undefined,
      text: (r.generated_text as string) ?? "",
      status: (r.status as string) ?? "draft",
      generatedBy: r.generated_by ? usersById.get(r.generated_by as string) : undefined,
      createdAt: r.created_at as string,
    }));
  },

  async crmSettings(): Promise<CrmSetting[]> {
    const { data, error } = await supabaseAdmin()
      .from("crm_settings")
      .select("*")
      .order("key", { ascending: true });
    if (error) throw new Error(`crmSettings: ${error.message}`);
    return (data ?? []).map((r) => ({
      key: r.key as string,
      value: r.value,
      description: (r.description as string) ?? undefined,
      editable: Boolean(r.is_editable),
    }));
  },

  async leadSourcesList(): Promise<LeadSourceInfo[]> {
    const { data, error } = await supabaseAdmin()
      .from("lead_sources")
      .select("*")
      .order("display_order", { ascending: true });
    if (error) throw new Error(`leadSourcesList: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      key: r.key as string,
      label: (r.label as string) ?? (r.key as string),
      sourceType: (r.source_type as string) ?? "other",
      active: Boolean(r.is_active),
    }));
  },
};
