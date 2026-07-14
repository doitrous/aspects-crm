/**
 * Domain model for the Aspects Clinica CRM.
 *
 * These types mirror the planned Supabase schema (see supabase/migrations).
 * The mock data layer (lib/data) implements the same shapes so swapping to a
 * live Supabase client later is a drop-in replacement, not a rewrite.
 */

export type Role = "admin" | "auditor" | "moderator" | "viewer";

export type Platform =
  | "facebook"
  | "instagram"
  | "whatsapp"
  | "walk_in"
  | "phone"
  | "web"
  | "referral";

export type PipelineStage =
  | "new"
  | "qualified"
  | "booked"
  | "follow_up"
  | "post_op"
  | "lost";

export type BookingStatus =
  | "none"
  | "unconfirmed"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type MessageDirection = "incoming" | "outgoing";
export type MessageChannel = "facebook" | "instagram" | "whatsapp" | "comment";

export type EscalationSeverity = "low" | "medium" | "high" | "critical";
export type EscalationStatus = "open" | "assigned" | "resolved";

export type DuplicateStatus = "none" | "suspected" | "linked" | "merged" | "not_duplicate";

/** Reviewer decision on a suspected duplicate pair (maps to DB flag status). */
export type DuplicateDecision = "merged" | "linked" | "dismissed";

export interface Doctor {
  id: string;
  name: string;
  specialtyIds: string[];
  rating: number;
  branch: string;
}

export interface Specialty {
  id: string;
  name: string;
}

export interface Campaign {
  id: string;
  name: string;
  source: string; // e.g. facebook, instagram
}

export interface User {
  id: string;
  name: string;
  role: Role;
  initials: string;
  avatarUrl?: string;
}

/** How far an outgoing message has travelled. `null` for incoming messages. */
export type DeliveryStatus = "sent" | "delivered" | "seen";

/** How sure we are that a platform identifier really identifies one person. */
export type IdentityConfidence = "strong" | "medium" | "weak" | "none";

/**
 * One attachment on a message or comment. Meta sends an array; the CRM keeps
 * every element, in the order Meta sent it, because "photo + caption" and
 * "three photos" are both single messages a moderator must see in full.
 */
export interface MessageAttachment {
  id: string;
  index: number;
  type: string; // image | video | audio | file | sticker | share | …
  rawType?: string; // the platform's own word, when it differs
  url?: string;
  title?: string;
  name?: string;
  stickerId?: string;
}

/** A reaction currently displayed on a message bubble. */
export interface MessageReaction {
  id: string;
  emoji?: string;
  type?: string;
  actorName?: string;
  reactedAt: string;
}

/** The message a reply points back at, enough to render a quoted preview. */
export interface ReplyContext {
  messageId: string; // platform message id
  localId?: string; // CRM row id, when we have the original
  body?: string;
  authorName?: string;
}

export interface Message {
  id: string;
  leadId: string;
  channel: MessageChannel;
  direction: MessageDirection;
  body: string;
  createdAt: string; // ISO
  authorName?: string;
  // comment-specific
  postRef?: string;

  // ── Meta ingestion (0005) ────────────────────────────────────────────
  platformMessageId?: string;
  messageType?: string;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  replyTo?: ReplyContext;
  /** > 0 means the sender edited this message; the bubble shows "Edited". */
  editCount?: number;
  editedAt?: string;
  deliveryStatus?: DeliveryStatus;
  deliveredAt?: string;
  seenAt?: string;
  /** Present when the bubble originated from a quick-reply chip. */
  quickReplyText?: string;
  /** Present when the bubble originated from a button/postback tap. */
  postbackTitle?: string;
  isDeleted?: boolean;
  isUnsupported?: boolean;
}

/** Where a comment sits in its thread. */
export type CommentThreadRole = "top_level" | "reply" | "business_reply";

export interface Comment {
  id: string;
  leadId?: string;
  platform: "facebook" | "instagram";
  commentId: string;
  parentCommentId?: string;
  threadRootCommentId?: string;
  threadRole: CommentThreadRole;
  isReply: boolean;
  isPageOrBusinessReply: boolean;
  body: string;
  createdAt: string; // ISO
  authorName?: string;
  authorUsername?: string;
  identityConfidence?: IdentityConfidence;
  postId?: string;
  mediaId?: string;
  mediaPermalink?: string;
  mediaCaption?: string;
  mediaType?: string;
  /** `ig_live` / `live` marks an Instagram Live comment. */
  mediaProductType?: string;
  commentLink?: string;
  attachments?: MessageAttachment[];
  isEdited: boolean;
  isDeleted: boolean;
  editCount: number;
  /** Children, nested by `parentCommentId`. */
  replies?: Comment[];
}

/**
 * First- and latest-touch ad attribution for a lead. First touch is written
 * once and never overwritten — it is the answer to "which ad won this lead".
 */
export interface LeadAttribution {
  leadId: string;
  firstSource?: string;
  firstCampaign?: string;
  firstAdId?: string;
  firstAdName?: string;
  firstReferralSource?: string;
  firstReferralCode?: string;
  firstTouchAt?: string;
  latestSource?: string;
  latestCampaign?: string;
  latestAdId?: string;
  latestAdName?: string;
  latestReferralSource?: string;
  latestTouchAt?: string;
  touchCount: number;
}

export interface LeadNote {
  clientNotes: string;
  medicalHistory: string;
  generalNotes: string;
  updatedAt: string;
}

export interface FollowUp {
  id?: string;
  workflowType?: string;
  stageNumber?: number;
  nextDate?: string;
  reason?: string;
  status: "none" | "scheduled" | "done" | "missed" | "dropped";
  owner?: string;
  lastContact?: string;
  outcome?: string;
  notes?: string;
}

export type FollowUpWorkflowType = "follow_up" | "post_op";
export type FollowUpStepState = "upcoming" | "due" | "overdue" | "done" | "snoozed";

export interface FollowUpPlanStep {
  id?: string;
  templateStageId?: string;
  templateVersion?: number;
  sequence: number;
  name: string;
  dueAt?: string;
  state: FollowUpStepState;
  notes?: string;
  moderatorInstruction?: string;
  outcome?: string;
  completedAt?: string;
  completedBy?: string;
  snoozedAt?: string;
  assignedTo?: string;
}

export interface FollowUpPlan {
  workflowType: FollowUpWorkflowType;
  source: "snapshot" | "settings";
  steps: FollowUpPlanStep[];
}

export interface Booking {
  id: string;
  leadId: string;
  doctorId: string;
  specialtyId: string;
  branch: string;
  room?: string;
  startAt: string; // ISO
  durationMin: number;
  status: BookingStatus;
  source: Platform;
  /** Distinguishes staff-created bookings from public website reservations. */
  origin?: "crm" | "website";
  calendarSynced: boolean;
}

export interface TimelineEvent {
  id: string;
  leadId: string;
  at: string; // ISO
  kind:
    | "lead_created"
    | "message_in"
    | "message_out"
    | "stage_change"
    | "follow_up"
    | "booking"
    | "note"
    | "escalation"
    | "duplicate_merge"
    /** Ad / referral touch. A referral is a system event, never a chat bubble. */
    | "attribution"
    | "audit";
  label: string;
  body?: string;
  actor?: string;
}

export interface StageHistoryEntry {
  stage: PipelineStage;
  at: string;
  by: string;
  reason?: string;
}

export interface Escalation {
  id: string;
  leadId: string;
  reason: string;
  severity: EscalationSeverity;
  status: EscalationStatus;
  createdAt: string;
  raisedBy: string; // moderator name
  assignedTo?: string; // auditor/admin
  resolutionNote?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface Lead {
  id: string; // human Lead ID, e.g. L0001 (leads.lead_id)
  uid?: string; // DB primary key (leads.id, uuid) — used to join related tables
  /** The booking platform's appointment id, when this lead has a reservation.
   *  Lets a calendar booking resolve back to the lead that owns it. */
  bookingAppointmentId?: string;
  mrn?: string;
  patientName: string;
  phone: string;
  phones?: Array<{ id: string; number: string; label: string; primary: boolean }>;
  linkedLeads?: Array<{ linkId: string; id: string; name: string; phone: string; relationship: LeadRelationship }>;
  familyMembers?: Array<{ id: string; name: string; phone: string; sharedPhone: string }>;
  /** True when an admin/auditor removed this record from operational queues
   *  while retaining it permanently in the patient Database. */
  databaseOnly?: boolean;
  /** Historical source record retained after identity consolidation. */
  mergedRecord?: boolean;
  gender?: "male" | "female";
  platform: Platform;
  platformId?: string; // messenger/ig/whatsapp id
  chatLink?: string;
  sourceId?: string;
  sourceLabel?: string;
  campaignId?: string;
  specialtyId?: string;
  serviceName?: string; // real DB stores a free-text service (leads.service_name)
  serviceIds?: string[]; // canonical booking service ids stored in lead metadata
  serviceNames?: string[]; // frozen labels for all selected services
  doctorId?: string;
  doctorName?: string; // resolved display name when available
  doctorNames?: string[]; // all treating-doctor labels for compact lead views
  branch?: string;
  patientType: "new" | "returning";
  stage: PipelineStage;
  stageHistory: StageHistoryEntry[];
  assignedModerator?: string;
  tags: string[];
  tagColors?: Record<string, string>;

  // derived / operational
  unread: boolean;
  attentionMessage?: string;
  attentionTab?: "Log" | "Messenger" | "WhatsApp" | "Comments" | "Follow-Up" | "Booking" | "Payments / Financials";
  incomingUnanswered: boolean;
  overdue: boolean;
  escalated: boolean;
  duplicateStatus: DuplicateStatus;

  lastMessage?: string;
  lastMessageAt?: string; // ISO
  createdAt: string; // ISO
  lostReason?: string;

  bookingStatus: BookingStatus;
  bookingContext?: string;
  bookingCount?: number;
  overdueReason?: string;

  note: LeadNote;
  followUp: FollowUp;
}

export type LeadRelationship = "same_patient" | "relative" | "distant_relative" | "other";

export interface TreatingDoctorAssignment {
  id: string;
  doctorId: string;
  doctorName: string;
  specialtyId?: string;
  specialtyName?: string;
  serviceId?: string;
  serviceName?: string;
  bundleId?: string;
  primary: boolean;
}

/** Group of leads flagged as possible duplicates. */
export interface DuplicateGroup {
  id: string;
  reason: string; // matched-on summary, e.g. "Phone + Name"
  confidence: number; // 0..1
  leadIds: string[];
  status: DuplicateStatus;
}

/* ── list-level view models (Phase 3 queues & auditor) ───────────── */

/** Compact lead record used inside queue rows and duplicate comparisons. */
export interface LeadSummary {
  id: string; // human lead id (L0001)
  uid?: string; // DB uuid
  name: string;
  phone: string;
  mrn?: string;
  platformId?: string;
  stage: PipelineStage;
  platform: Platform;
  createdAt: string;
  serviceName?: string;
  serviceNames?: string[];
  doctorNames?: string[];
  assignedModerator?: string;
  tags?: string[];
  attentionMessage?: string;
  attentionTab?: string;
  databaseOnly?: boolean;
}

/** An escalation enriched with its lead, for the auditor escalations queue. */
export interface EscalationQueueItem extends Escalation {
  lead?: LeadSummary;
}

/** A single flagged duplicate pair for side-by-side review. */
export interface DuplicatePair {
  id: string;
  type: string; // matched-on, e.g. "phone" / "name"
  confidence: number; // 0..1
  status: DuplicateStatus;
  notes?: string;
  createdAt: string;
  reviewedBy?: string;
  primary?: LeadSummary;
  duplicate?: LeadSummary;
}

export type DuplicateQueueView = "open" | "resolved";

export interface DuplicateQueueResult {
  items: DuplicatePair[];
  total: number;
  openTotal: number;
  resolvedTotal: number;
  page: number;
  pageSize: number;
  view: DuplicateQueueView;
}

/** A lead in the follow-up workflow with its active stage. */
export interface FollowUpItem {
  lead: LeadSummary;
  workflowType?: string; // standard / post_op
  stageNumber?: number;
  dueAt?: string;
  reason?: string;
  status: string; // pending / completed / missed / dropped / none
  lastContactAt?: string;
  overdue: boolean;
}

/** Previous-day auditor snapshot sourced from `audit_daily_reports`. */
export interface AuditReport {
  date: string; // YYYY-MM-DD
  status: string; // draft / submitted / approved / reopened
  notes?: string;
  submittedBy?: string;
  approvedBy?: string;
  metrics: Record<string, number>; // auto snapshot merged with overrides
  overrides: string[]; // metric keys that were manually overridden
  oldLeadsDueNextDay?: number;
  auditedFollowupScore?: number;
}

/** Generated narrative report from `operational_summary_reports`. */
export interface SummaryReport {
  id: string;
  reportType: string; // e.g. auditor_clinic_daily_ar, moderator_daily_ar
  reportDate: string; // YYYY-MM-DD
  dateFrom?: string;
  dateTo?: string;
  text: string; // generated_text (may be Arabic / RTL)
  status: string; // draft / final
  generatedBy?: string;
  createdAt: string;
}

/** A row from `crm_settings` (jsonb value bag). */
export interface CrmSetting {
  key: string;
  value: unknown; // jsonb — shape varies per key
  description?: string;
  editable: boolean;
}

export interface ReferenceOption {
  id: string;
  label: string;
  color?: string;
}

/** A configured intake channel from `lead_sources`. */
export interface LeadSourceInfo {
  id: string;
  key: string;
  label: string;
  sourceType: string; // social / messaging / manual …
  active: boolean;
}

/* ── Booking platform source of truth ─────────────────────────── */

/** Appointment lifecycle, mirrored from the booking platform's `appointment_status` enum. */
export type ReservationStatus =
  | "reserved"
  | "confirmed"
  | "attended"
  | "no_show"
  | "cancelled"
  | "rescheduled";

/**
 * A patient reservation read live from the booking platform's `appointments`
 * table. This is a separate Supabase project, so it is never part of the CRM
 * DataProvider — it is fetched through `lib/booking/*` with its own credentials.
 */
export interface Reservation {
  id: string;
  leadId?: string;
  patientName: string;
  patientPhone: string; // country code + national number
  patientMrn?: string;
  patientEmail?: string;
  patientAge?: number;
  doctorId?: string;
  doctorName?: string;
  specialtyId?: string;
  specialtyName?: string;
  branchId?: string;
  branchName?: string;
  serviceId?: string;
  serviceName?: string;
  date: string; // YYYY-MM-DD (appointment_date)
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  status: ReservationStatus;
  isNewPatient: boolean;
  notes?: string;
  primaryComplaint?: string;
  referralSource?: string;
  feeAtBooking?: number;
  createdAt: string; // when the reservation was made
}
