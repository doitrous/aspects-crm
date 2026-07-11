import {
  attributionFor,
  commentsFor,
  messagesFor,
  leadTimeline,
  bookingsFor,
  escalationsFor,
  duplicatesFor,
} from "@/lib/data";
import type { LeadDetailData } from "@/components/lead/LeadDetail";
import { supabaseAdmin } from "@/lib/supabase/server";
import { leadFinancials, type LeadFinancials } from "@/lib/data/financials";
import { activeLeadTags, activeLostReasons } from "@/lib/data/leadMutations";
import { listEscalationReasons } from "@/lib/data/settingsData";
import { bookingCatalog } from "@/lib/booking/service";
import { loadFollowUpPlan } from "@/lib/data/followupPlans";
import { whatsappConfigured } from "@/lib/whatsapp/config";
import type { Lead, PipelineStage, Platform, TreatingDoctorAssignment } from "@/lib/types";

const DB_TO_UI_STAGE: Record<string, PipelineStage> = {
  new_lead: "new",
  qualified: "qualified",
  booked: "booked",
  follow_up: "follow_up",
  post_op_follow_up: "post_op",
  lost: "lost",
};

function toUiStage(status: string | null): PipelineStage {
  return (status && DB_TO_UI_STAGE[status]) || "new";
}

function toUiPlatform(platform: string | null): Platform {
  if (platform === "facebook_messenger" || platform === "facebook") return "facebook";
  if (platform === "instagram") return "instagram";
  if (platform === "whatsapp") return "whatsapp";
  return "web";
}

function buildPhone(row: { phone_country_code: string | null; phone_number: string | null; normalized_phone: string | null }): string {
  const cc = row.phone_country_code?.trim();
  const num = row.phone_number?.trim();
  if (num) return cc ? `${cc} ${num}` : num;
  return row.normalized_phone ?? "";
}

const SHELL_COLUMNS =
  "id,lead_id,mrn,name,status,platform,platform_id,chat_link,gender," +
  "phone_country_code,phone_number,normalized_phone,source_id,service_name," +
  "campaign,doctor_id,coordinator_user_id,escalation_status,has_unread," +
  "is_reply_overdue,booking_appointment_id,lost_reason_id,notes,medical_notes," +
  "medical_history,ai_summary,last_incoming_at,last_outgoing_at,last_contact_at," +
  "created_at,updated_at,metadata";

type ShellRow = {
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
  campaign: string | null;
  doctor_id: string | null;
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
  metadata: Record<string, unknown> | null;
};

async function loadLeadShell(id: string): Promise<Lead | null> {
  const { data: row, error } = await supabaseAdmin()
    .from("leads")
    .select(SHELL_COLUMNS)
    .eq("lead_id", id)
    .maybeSingle<ShellRow>();
  if (error) throw new Error(`loadLeadShell: ${error.message}`);
  if (!row) return null;

  const [tagsRes, userRes, lostReasonRes] = await Promise.all([
    supabaseAdmin()
      .from("lead_tag_assignments")
      .select("lead_tags(name,color)")
      .eq("lead_id", row.id),
    row.coordinator_user_id
      ? supabaseAdmin().from("crm_users").select("full_name,email").eq("id", row.coordinator_user_id).maybeSingle()
      : Promise.resolve({ data: null }),
    row.lost_reason_id
      ? supabaseAdmin().from("lost_reasons").select("label").eq("id", row.lost_reason_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (tagsRes.error) throw new Error(`loadLeadShell(tags): ${tagsRes.error.message}`);

  const tagRows = ((tagsRes.data ?? []) as { lead_tags?: { name?: string | null; color?: string | null } | { name?: string | null; color?: string | null }[] | null }[])
    .map((r) => Array.isArray(r.lead_tags) ? r.lead_tags[0] : r.lead_tags)
    .filter((tag): tag is { name: string; color?: string | null } => Boolean(tag?.name));
  const tags = tagRows.map((tag) => tag.name);
  const user = userRes.data as { full_name?: string | null; email?: string | null } | null;
  const lost = lostReasonRes.data as { label?: string | null } | null;
  const lastMessageAt = row.last_incoming_at ?? row.last_outgoing_at ?? row.last_contact_at ?? row.updated_at;
  const metadata = row.metadata ?? {};

  return {
    id: row.lead_id,
    uid: row.id,
    mrn: row.mrn ?? undefined,
    patientName: row.name?.trim() || "Unnamed lead",
    phone: buildPhone(row),
    gender: row.gender === "male" || row.gender === "female" ? row.gender : undefined,
    platform: toUiPlatform(row.platform),
    platformId: row.platform_id ?? undefined,
    chatLink: row.chat_link ?? undefined,
    sourceId: row.source_id ?? undefined,
    specialtyId: typeof metadata.specialty_id === "string" ? metadata.specialty_id : undefined,
    campaignId: row.campaign ?? undefined,
    serviceName: row.service_name ?? undefined,
    doctorId: row.doctor_id ?? undefined,
    patientType: "new",
    stage: toUiStage(row.status),
    stageHistory: [],
    assignedModerator: user ? (user.full_name?.trim() || user.email || undefined) : undefined,
    tags,
    tagColors: Object.fromEntries(tagRows.filter((tag) => tag.color).map((tag) => [tag.name, tag.color!])),
    unread: row.has_unread,
    attentionMessage: typeof metadata.moderator_notice === "string" ? metadata.moderator_notice : undefined,
    attentionTab: typeof metadata.moderator_notice_tab === "string" ? metadata.moderator_notice_tab as Lead["attentionTab"] : undefined,
    incomingUnanswered: row.has_unread,
    overdue: row.is_reply_overdue,
    escalated: ["escalated", "in_review"].includes(row.escalation_status ?? "none"),
    duplicateStatus: "none",
    lastMessage: row.ai_summary ?? undefined,
    lastMessageAt,
    createdAt: row.created_at,
    lostReason: lost?.label ?? undefined,
    bookingStatus: row.booking_appointment_id ? "unconfirmed" : "none",
    bookingAppointmentId: row.booking_appointment_id ?? undefined,
    note: {
      clientNotes: row.notes ?? "",
      medicalHistory: row.medical_history ?? "",
      generalNotes: row.medical_notes ?? "",
      updatedAt: row.updated_at,
    },
    followUp: { status: "none" },
  };
}

async function treatingDoctorsFor(leadUid: string): Promise<TreatingDoctorAssignment[]> {
  const { data, error } = await supabaseAdmin().from("crm_lead_treating_doctors")
    .select("id,doctor_id,doctor_name,specialty_id,specialty_name,service_id,service_name,bundle_id,is_primary")
    .eq("lead_id", leadUid).eq("active", true).order("is_primary", { ascending: false });
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) return [];
    throw new Error(`treatingDoctorsFor: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    doctorId: row.doctor_id as string,
    doctorName: row.doctor_name as string,
    specialtyId: (row.specialty_id as string | null) ?? undefined,
    specialtyName: (row.specialty_name as string | null) ?? undefined,
    serviceId: (row.service_id as string | null) ?? undefined,
    serviceName: (row.service_name as string | null) ?? undefined,
    bundleId: (row.bundle_id as string | null) ?? undefined,
    primary: Boolean(row.is_primary),
  }));
}

/**
 * The financial record is the one part of the drawer that can be missing for a
 * reason other than "no data": the viewer may lack `financial.view`, the lead
 * may predate the financial tables, or migration `0007` may not have been
 * applied yet. None of those should take the whole lead detail down with them,
 * but the reason must not be swallowed; the Payments tab needs the real error
 * so production schema/RLS/env failures are visible instead of looking empty.
 */
async function loadFinancials(id: string): Promise<{ financials: LeadFinancials | null; error: string | null }> {
  try {
    return { financials: await leadFinancials(id), error: null };
  } catch (error) {
    return {
      financials: null,
      error: error instanceof Error ? error.message : "Financial records could not be loaded.",
    };
  }
}

/**
 * Loads everything the lead detail view needs. Shared by the full-page route
 * (direct load / refresh) and the intercepted slide-over drawer so the two
 * never drift.
 */
export async function loadLeadDetail(id: string): Promise<LeadDetailData | null> {
  const [lead, availableTags, lostReasons, escalationReasonRows] = await Promise.all([
    loadLeadShell(id),
    activeLeadTags(),
    activeLostReasons(),
    listEscalationReasons(),
  ]);
  if (!lead) return null;
  const escalationReasons = escalationReasonRows
    .filter((r) => r.isActive)
    .map((r) => ({ id: r.id, label: r.label, severity: r.severity }));

  return {
    lead,
    messages: [],
    comments: [],
    attribution: null,
    timeline: [],
    bookings: [],
    escalations: [],
    duplicateGroups: [],
    financials: null,
    financialsError: null,
    followUpPlan: null,
    whatsappConfigured: false,
    availableTags,
    lostReasons,
    escalationReasons,
    treatingDoctors: [],
    bookingCatalog: {
      configured: false,
      specialties: [],
      doctors: [],
      branches: [],
      services: [],
      settings: {
        bookingWindowDays: 90,
        minNoticeHours: 6,
        defaultDurationMinutes: 20,
        firstComeDefaultCapacity: 10,
      },
    },
  };
}

async function duplicateGroupsWithMembers(id: string): Promise<LeadDetailData["duplicateGroups"]> {
  const groups = await duplicatesFor(id);
  const ids = [...new Set(groups.flatMap((g) => g.leadIds))];
  if (!ids.length) return groups.map((g) => ({ ...g, members: [] }));
  const { data: leads, error } = await supabaseAdmin()
    .from("leads")
    .select("lead_id,name,phone_country_code,phone_number,normalized_phone")
    .in("lead_id", ids);
  if (error) throw new Error(`duplicateGroupsWithMembers: ${error.message}`);
  const byId = new Map(
    (leads ?? []).map((l) => [
      l.lead_id as string,
      {
        id: l.lead_id as string,
        name: (l.name as string | null)?.trim() || "Unnamed lead",
        phone: buildPhone(l as { phone_country_code: string | null; phone_number: string | null; normalized_phone: string | null }),
      },
    ]),
  );
  return groups.map((g) => ({
    ...g,
    members: g.leadIds.map((lid) => byId.get(lid)).filter((l): l is { id: string; name: string; phone: string } => Boolean(l)),
  }));
}

export async function loadLeadTab(
  id: string,
  tab: "Overview" | "Messenger" | "Messenger / IG DM" | "WhatsApp" | "Comments" | "Follow-Up" | "Booking" | "Payments" | "Payments / Financials" | "Log" | "Timeline",
): Promise<Partial<LeadDetailData> | null> {
  const { data: lead, error } = await supabaseAdmin()
    .from("leads")
    .select("id")
    .eq("lead_id", id)
    .maybeSingle();
  if (error) throw new Error(`loadLeadTab: ${error.message}`);
  if (!lead) return null;

  if (tab === "Overview") {
    const [attribution, messages, catalog, treatingDoctors] = await Promise.all([
      attributionFor(id),
      messagesFor(id),
      bookingCatalog(),
      treatingDoctorsFor(lead.id as string),
    ]);
    return { attribution, messages: messages.slice(-1), bookingCatalog: catalog, treatingDoctors };
  }

  if (tab === "Messenger" || tab === "Messenger / IG DM") return { messages: await messagesFor(id, ["facebook", "instagram"]) };
  if (tab === "WhatsApp") return { messages: await messagesFor(id, ["whatsapp"]), whatsappConfigured: whatsappConfigured() };
  if (tab === "Comments") return { comments: await commentsFor(id) };
  if (tab === "Follow-Up") return { followUpPlan: await loadFollowUpPlan(id) };
  if (tab === "Booking") {
    const [bookings, catalog] = await Promise.all([bookingsFor(id), bookingCatalog()]);
    return { bookings, bookingCatalog: catalog };
  }
  if (tab === "Payments" || tab === "Payments / Financials") {
    const result = await loadFinancials(id);
    return { financials: result.financials, financialsError: result.error };
  }
  if (tab === "Log" || tab === "Timeline") {
    const [timeline, escalations, duplicateGroups] = await Promise.all([
      leadTimeline(id),
      escalationsFor(id),
      duplicateGroupsWithMembers(id),
    ]);
    return { timeline, escalations, duplicateGroups };
  }

  return {};
}

export async function loadFullLeadDetail(id: string): Promise<LeadDetailData | null> {
  const shell = await loadLeadDetail(id);
  if (!shell) return null;
  const [
    messages,
    comments,
    attribution,
    timeline,
    bookings,
    escalations,
    duplicateGroups,
    financialResult,
    catalog,
    followUpPlan,
  ] =
    await Promise.all([
      messagesFor(id),
      commentsFor(id),
      attributionFor(id),
      leadTimeline(id),
      bookingsFor(id),
      escalationsFor(id),
      duplicateGroupsWithMembers(id),
      loadFinancials(id),
      bookingCatalog(),
      loadFollowUpPlan(id),
    ]);

  return {
    lead: shell.lead,
    messages,
    comments,
    attribution,
    timeline,
    bookings,
    escalations,
    duplicateGroups,
    financials: financialResult.financials,
    financialsError: financialResult.error,
    followUpPlan,
    whatsappConfigured: whatsappConfigured(),
    availableTags: shell.availableTags,
    lostReasons: shell.lostReasons,
    escalationReasons: shell.escalationReasons,
    bookingCatalog: catalog,
    treatingDoctors: await treatingDoctorsFor(shell.lead.uid!),
  };
}
