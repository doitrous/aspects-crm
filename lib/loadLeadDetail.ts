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
import { deriveLeadBookingSummary } from "@/lib/booking/leadSummary";
import { refreshReplyOverdueFlags } from "@/lib/data/replySla";
import type { Lead, PipelineStage, Platform, TreatingDoctorAssignment } from "@/lib/types";
import { getSessionUser } from "@/lib/data/session";
import { can } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format";

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
  "is_reply_overdue,reply_overdue_at,booking_appointment_id,lost_reason_id,notes,medical_notes," +
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
  reply_overdue_at: string | null;
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
  await refreshReplyOverdueFlags();
  const { data: row, error } = await supabaseAdmin()
    .from("leads")
    .select(SHELL_COLUMNS)
    .eq("lead_id", id)
    .maybeSingle<ShellRow>();
  if (error) throw new Error(`loadLeadShell: ${error.message}`);
  if (!row) return null;

  const [tagsRes, userRes, lostReasonRes, phonesRes] = await Promise.all([
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
    supabaseAdmin().from("crm_lead_phones").select("id,country_code,phone_number,label,is_primary").eq("lead_id", row.id).order("is_primary", { ascending: false }),
  ]);
  if (tagsRes.error) throw new Error(`loadLeadShell(tags): ${tagsRes.error.message}`);

  const tagRows = ((tagsRes.data ?? []) as { lead_tags?: { name?: string | null; color?: string | null } | { name?: string | null; color?: string | null }[] | null }[])
    .map((r) => Array.isArray(r.lead_tags) ? r.lead_tags[0] : r.lead_tags)
    .filter((tag): tag is { name: string; color?: string | null } => Boolean(tag?.name));
  const user = userRes.data as { full_name?: string | null; email?: string | null } | null;
  const lost = lostReasonRes.data as { label?: string | null } | null;
  const lastMessageAt = row.last_incoming_at ?? row.last_outgoing_at ?? row.last_contact_at ?? row.updated_at;
  const metadata = row.metadata ?? {};
  const revisiting = metadata.revisiting_patient === true;
  const visibleTagRows = revisiting && !tagRows.some((tag) => tag.name === "Revisiting Patient")
    ? [...tagRows, { name: "Revisiting Patient", color: "#7c3aed" }]
    : tagRows;
  const bookingSummary = deriveLeadBookingSummary(metadata, row.booking_appointment_id);

  return {
    id: row.lead_id,
    uid: row.id,
    mrn: row.mrn ?? undefined,
    patientName: row.name?.trim() || "Unnamed lead",
    phone: buildPhone(row),
    phones: ((phonesRes.data ?? []) as Array<{ id: string; country_code: string | null; phone_number: string; label: string; is_primary: boolean }>).map((phone) => ({
      id: phone.id,
      number: [phone.country_code, phone.phone_number].filter(Boolean).join(" "),
      label: phone.label,
      primary: phone.is_primary,
    })),
    gender: row.gender === "male" || row.gender === "female" ? row.gender : undefined,
    platform: toUiPlatform(row.platform),
    platformId: row.platform_id ?? undefined,
    chatLink: row.chat_link ?? undefined,
    sourceId: row.source_id ?? undefined,
    sourceLabel: metadata.record_source === "database" ? "Database" : undefined,
    databaseOnly: metadata.database_only === true,
    specialtyId: typeof metadata.specialty_id === "string" ? metadata.specialty_id : undefined,
    campaignId: row.campaign ?? undefined,
    serviceName: row.service_name ?? undefined,
    serviceIds: Array.isArray(metadata.service_ids) ? metadata.service_ids.filter((value): value is string => typeof value === "string") : undefined,
    serviceNames: Array.isArray(metadata.service_names) ? metadata.service_names.filter((value): value is string => typeof value === "string") : row.service_name ? [row.service_name] : undefined,
    doctorId: row.doctor_id ?? undefined,
    doctorNames: Array.isArray(metadata.treating_doctor_names) ? metadata.treating_doctor_names.filter((value): value is string => typeof value === "string") : undefined,
    patientType: revisiting ? "returning" : "new",
    stage: toUiStage(row.status),
    stageHistory: [],
    assignedModerator: user ? (user.full_name?.trim() || user.email || undefined) : undefined,
    tags: visibleTagRows.map((tag) => tag.name),
    tagColors: Object.fromEntries(visibleTagRows.filter((tag) => tag.color).map((tag) => [tag.name, tag.color!])),
    unread: row.has_unread,
    attentionMessage: typeof metadata.moderator_notice === "string" ? metadata.moderator_notice : undefined,
    attentionTab: typeof metadata.moderator_notice_tab === "string" ? metadata.moderator_notice_tab as Lead["attentionTab"] : undefined,
    incomingUnanswered: row.has_unread,
    overdue: row.is_reply_overdue,
    overdueReason: row.is_reply_overdue ? `Unread patient message passed its reply deadline${row.reply_overdue_at ? ` at ${formatDateTime(row.reply_overdue_at)}` : ""}.` : undefined,
    escalated: ["escalated", "in_review"].includes(row.escalation_status ?? "none"),
    duplicateStatus: "none",
    lastMessage: row.ai_summary ?? undefined,
    lastMessageAt,
    createdAt: row.created_at,
    lostReason: lost?.label ?? undefined,
    bookingStatus: bookingSummary.status,
    bookingContext: bookingSummary.context,
    bookingCount: bookingSummary.count,
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

async function patientConnectionsFor(leadUid: string): Promise<Pick<Lead, "linkedLeads" | "familyMembers">> {
  const db = supabaseAdmin();
  const [{ data: links, error: linksError }, { data: ownPhones, error: phonesError }] = await Promise.all([
    db.from("crm_lead_links").select("id,lead_a_id,lead_b_id,relationship").or(`lead_a_id.eq.${leadUid},lead_b_id.eq.${leadUid}`),
    db.from("crm_lead_phones").select("normalized_phone").eq("lead_id", leadUid),
  ]);
  if (linksError) throw new Error(`patientConnections(links): ${linksError.message}`);
  if (phonesError) throw new Error(`patientConnections(phones): ${phonesError.message}`);
  const linkedIds = (links ?? []).map((link) => link.lead_a_id === leadUid ? link.lead_b_id : link.lead_a_id) as string[];
  const normalized = (ownPhones ?? []).map((phone) => phone.normalized_phone as string).filter(Boolean);
  const familyPhoneRows = normalized.length ? await db.from("crm_lead_phones").select("lead_id,normalized_phone").in("normalized_phone", normalized).neq("lead_id", leadUid) : { data: [], error: null };
  if (familyPhoneRows.error) throw new Error(`patientConnections(family): ${familyPhoneRows.error.message}`);
  const familyIds = [...new Set((familyPhoneRows.data ?? []).map((row) => row.lead_id as string).filter((id) => !linkedIds.includes(id)))];
  const allIds = [...new Set([...linkedIds, ...familyIds])];
  if (!allIds.length) return { linkedLeads: [], familyMembers: [] };
  const { data: members, error } = await db.from("leads").select("id,lead_id,name,phone_country_code,phone_number,normalized_phone").in("id", allIds);
  if (error) throw new Error(`patientConnections(members): ${error.message}`);
  const byId = new Map((members ?? []).map((member) => [member.id as string, member]));
  return {
    linkedLeads: (links ?? []).map((link) => {
      const uid = (link.lead_a_id === leadUid ? link.lead_b_id : link.lead_a_id) as string;
      const member = byId.get(uid);
      const relationship = link.relationship === "family" ? "relative" : link.relationship;
      return member ? { linkId: link.id as string, id: member.lead_id as string, name: (member.name as string | null) || "Unnamed", phone: buildPhone(member as never), relationship: relationship as "same_patient" | "relative" | "distant_relative" | "other" } : null;
    }).filter((member): member is NonNullable<typeof member> => Boolean(member)),
    familyMembers: (familyPhoneRows.data ?? []).map((phoneRow) => {
      const member = byId.get(phoneRow.lead_id as string);
      return member ? { id: member.lead_id as string, name: (member.name as string | null) || "Unnamed", phone: buildPhone(member as never), sharedPhone: phoneRow.normalized_phone as string } : null;
    }).filter((member): member is NonNullable<typeof member> => Boolean(member)),
  };
}

async function linkedHumanLeadIds(leadUid: string, currentId: string): Promise<string[]> {
  const db = supabaseAdmin();
  const { data: links, error } = await db.from("crm_lead_links")
    .select("lead_a_id,lead_b_id").eq("relationship", "same_patient")
    .or(`lead_a_id.eq.${leadUid},lead_b_id.eq.${leadUid}`);
  if (error) throw new Error(`linkedHumanLeadIds: ${error.message}`);
  const uids = (links ?? []).map((link) => link.lead_a_id === leadUid ? link.lead_b_id : link.lead_a_id) as string[];
  if (!uids.length) return [currentId];
  const { data: rows, error: leadError } = await db.from("leads").select("lead_id").in("id", uids);
  if (leadError) throw new Error(`linkedHumanLeadIds(leads): ${leadError.message}`);
  return [...new Set([currentId, ...(rows ?? []).map((row) => row.lead_id as string)])];
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
    console.error("Lead financial records failed to load", error);
    return {
      financials: null,
      error: "Financial records could not be loaded. Please retry or contact an administrator.",
    };
  }
}

/**
 * Loads everything the lead detail view needs. Shared by the full-page route
 * (direct load / refresh) and the intercepted slide-over drawer so the two
 * never drift.
 */
export async function loadLeadDetail(id: string): Promise<LeadDetailData | null> {
  const [lead, availableTags, lostReasons, escalationReasonRows, viewer] = await Promise.all([
    loadLeadShell(id),
    activeLeadTags(),
    activeLostReasons(),
    listEscalationReasons(),
    getSessionUser(),
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
    canReturnToDatabase: viewer ? can(viewer.role, "leads.returnToDatabase") : false,
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
    .select("lead_id,name,mrn,phone_country_code,phone_number,normalized_phone")
    .in("lead_id", ids);
  if (error) throw new Error(`duplicateGroupsWithMembers: ${error.message}`);
  const byId = new Map(
    (leads ?? []).map((l) => [
      l.lead_id as string,
      {
        id: l.lead_id as string,
        name: (l.name as string | null)?.trim() || "Unnamed lead",
        phone: buildPhone(l as { phone_country_code: string | null; phone_number: string | null; normalized_phone: string | null }),
        mrn: (l.mrn as string | null) ?? undefined,
      },
    ]),
  );
  return groups.map((g) => ({
    ...g,
    members: g.leadIds.map((lid) => byId.get(lid)).filter((l): l is NonNullable<typeof l> => Boolean(l)),
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
  const relatedIds = await linkedHumanLeadIds(lead.id as string, id);

  if (tab === "Overview") {
    const currentLead = await loadLeadShell(id);
    if (!currentLead) return null;
    const [attribution, messages, catalog, treatingDoctors, connections] = await Promise.all([
      attributionFor(id),
      Promise.all(relatedIds.map((relatedId) => messagesFor(relatedId))).then((groups) => groups.flat().sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
      bookingCatalog(),
      treatingDoctorsFor(lead.id as string),
      patientConnectionsFor(lead.id as string),
    ]);
    return { attribution, messages: messages.slice(-1), bookingCatalog: catalog, treatingDoctors, lead: { ...currentLead, ...connections } };
  }

  if (tab === "Messenger" || tab === "Messenger / IG DM") return { messages: (await Promise.all(relatedIds.map((relatedId) => messagesFor(relatedId, ["facebook", "instagram"])))).flat().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)) };
  if (tab === "WhatsApp") return { messages: (await Promise.all(relatedIds.map((relatedId) => messagesFor(relatedId, ["whatsapp"])))).flat().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)), whatsappConfigured: whatsappConfigured() };
  if (tab === "Comments") return { comments: (await Promise.all(relatedIds.map((relatedId) => commentsFor(relatedId)))).flat().sort((a,b)=>a.createdAt.localeCompare(b.createdAt)) };
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
    const [timeline, escalations, duplicateGroups, currentLead] = await Promise.all([
      Promise.all(relatedIds.map((relatedId) => leadTimeline(relatedId))).then((groups) => groups.flat().sort((a,b)=>b.at.localeCompare(a.at))),
      Promise.all(relatedIds.map((relatedId) => escalationsFor(relatedId))).then((groups) => groups.flat().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))),
      duplicateGroupsWithMembers(id),
      loadLeadShell(id),
    ]);
    const connections = currentLead?.uid ? await patientConnectionsFor(currentLead.uid) : { linkedLeads: [], familyMembers: [] };
    return { timeline, escalations, duplicateGroups, ...(currentLead ? { lead: { ...currentLead, ...connections } } : {}) };
  }

  return {};
}

export async function loadFullLeadDetail(id: string): Promise<LeadDetailData | null> {
  const shell = await loadLeadDetail(id);
  if (!shell) return null;
  const relatedIds = await linkedHumanLeadIds(shell.lead.uid!, id);
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
      Promise.all(relatedIds.map((relatedId) => messagesFor(relatedId))).then((groups) => groups.flat().sort((a,b)=>a.createdAt.localeCompare(b.createdAt))),
      Promise.all(relatedIds.map((relatedId) => commentsFor(relatedId))).then((groups) => groups.flat().sort((a,b)=>a.createdAt.localeCompare(b.createdAt))),
      attributionFor(id),
      Promise.all(relatedIds.map((relatedId) => leadTimeline(relatedId))).then((groups) => groups.flat().sort((a,b)=>b.at.localeCompare(a.at))),
      bookingsFor(id),
      Promise.all(relatedIds.map((relatedId) => escalationsFor(relatedId))).then((groups) => groups.flat().sort((a,b)=>b.createdAt.localeCompare(a.createdAt))),
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
    canReturnToDatabase: shell.canReturnToDatabase,
  };
}
