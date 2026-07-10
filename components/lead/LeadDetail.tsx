"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  Booking,
  Comment,
  DuplicateGroup,
  Escalation,
  Lead,
  LeadAttribution,
  Message,
  PipelineStage,
  Platform,
  ReferenceOption,
  TimelineEvent,
} from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CommentsPanel } from "@/components/lead/CommentsPanel";
import { MessageThread } from "@/components/lead/MessageThread";
import { NotesTab } from "@/components/lead/NotesTab";
import { BookingTab } from "@/components/lead/BookingTab";
import { PaymentsTab } from "@/components/lead/PaymentsTab";
import type { LeadFinancials } from "@/lib/data/financials";
import {
  PLATFORM_META,
  SEVERITY_META,
  STAGE_META,
} from "@/lib/badges";
import {
  campaignName,
  doctorName,
  sourceName,
  specialtyName,
} from "@/lib/data/reference";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  clearLeadEscalationAction,
  completeFollowUpAction,
  escalateLeadAction,
  scheduleFollowUpAction,
  setLeadTagsAction,
  snoozeFollowUpAction,
  updateLeadStageAction,
} from "@/app/(crm)/leads/actions";
import {
  resolveEscalationAction,
  returnEscalationAction,
} from "@/app/(crm)/escalations/actions";
import { resolveDuplicateAction } from "@/app/(crm)/duplicates/actions";
import { EscalationResolutionControls } from "@/components/queues/EscalationResolutionControls";

const TABS = [
  "Overview",
  "Conversation",
  "Comments",
  "Notes",
  "Follow-Up",
  "Booking",
  "Payments",
  "Log",
] as const;
type Tab = (typeof TABS)[number];

/** Short channel label shown next to the status badge, e.g. "IG DM". */
const CHANNEL_LABEL: Record<Platform, string> = {
  facebook: "FB DM",
  instagram: "IG DM",
  whatsapp: "WhatsApp",
  web: "Web",
  referral: "Referral",
  walk_in: "Walk-in",
  phone: "Phone",
};

/** Change-status pills: display order and short labels (independent of the
 *  longer STAGE_META labels used on list badges). */
const STATUS_PILL_ORDER: PipelineStage[] = [
  "new",
  "qualified",
  "follow_up",
  "post_op",
  "booked",
  "lost",
];
const STATUS_PILL_LABEL: Record<PipelineStage, string> = {
  new: "New",
  qualified: "Qualified",
  follow_up: "Follow-Up",
  post_op: "Post-Op",
  booked: "Booked",
  lost: "Lost",
};

/** Timeline dot color per event kind. Stage changes are colored by their
 *  target stage via {@link STAGE_DOT} instead. */
const KIND_DOT: Record<TimelineEvent["kind"], string> = {
  lead_created: "#2e90fa",
  message_in: "#2e90fa",
  message_out: "#2e90fa",
  stage_change: "#667085",
  follow_up: "#dc6803",
  booking: "#3538cd",
  note: "#98a2b3",
  escalation: "#b42318",
  duplicate_merge: "#98a2b3",
  attribution: "#98a2b3",
  audit: "#98a2b3",
};
const STAGE_DOT: Record<PipelineStage, string> = {
  new: "#2e90fa",
  qualified: "#12b76a",
  follow_up: "#dc6803",
  post_op: "#0e9384",
  booked: "#3538cd",
  lost: "#b42318",
};

export interface LeadDetailData {
  lead: Lead;
  messages: Message[];
  comments: Comment[];
  attribution: LeadAttribution | null;
  timeline: TimelineEvent[];
  bookings: Booking[];
  escalations: Escalation[];
  duplicateGroups: (DuplicateGroup & { members: { id: string; name: string; phone: string }[] })[];
  bookingCatalog: React.ComponentProps<typeof BookingTab>["catalog"];
  /** `null` when the viewer may not see financials, or the records are unreadable. */
  financials: LeadFinancials | null;
  financialsError: string | null;
  availableTags: ReferenceOption[];
  lostReasons: ReferenceOption[];
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-[11.5px] text-ink-400">{label}</span>
      <span className="text-right text-[12px] font-medium text-ink-700">{value}</span>
    </div>
  );
}

/** Stacked label-over-value field used in the Overview lead details grid.
 *  Values are bold and dark to match the reference design. */
function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] text-ink-400">{label}</div>
      <div className="mt-0.5 text-[14px] font-semibold text-ink-900">{value}</div>
    </div>
  );
}

export function LeadDetail({ data, onClose }: { data: LeadDetailData; onClose?: () => void }) {
  const { lead } = data;
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : "Overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [stage, setStage] = useState<PipelineStage>(lead.stage);
  const [tags, setTags] = useState<string[]>(lead.tags);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  const [lostModal, setLostModal] = useState(false);
  const [lostReasonId, setLostReasonId] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const [escalateModal, setEscalateModal] = useState(false);
  const [escalationReason, setEscalationReason] = useState("");
  const [escalationSeverity, setEscalationSeverity] = useState("medium");

  const pm = PLATFORM_META[lead.platform];

  useEffect(() => {
    if (requestedTab && TABS.includes(requestedTab as Tab)) setTab(requestedTab as Tab);
  }, [requestedTab]);

  function run(action: () => Promise<{ ok: string | null; error: string | null }>, onOk?: () => void) {
    startTransition(async () => {
      setActionError(null);
      setActionOk(null);
      try {
        const result = await action();
        if (result.error) {
          setActionError(result.error);
          return;
        }
        setActionOk(result.ok);
        onOk?.();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Action failed.");
      }
    });
  }

  function changeStage(next: PipelineStage) {
    if (next === stage) return;
    if (next === "lost") {
      setLostModal(true);
      return;
    }
    run(() => updateLeadStageAction(lead.id, next), () => setStage(next));
  }

  function toggleTag(tag: string) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    run(() => {
      const ids = data.availableTags.filter((t) => next.includes(t.label)).map((t) => t.id);
      return setLeadTagsAction(lead.id, ids);
    }, () => setTags(next));
  }

  function submitLost() {
    run(
      () => updateLeadStageAction(lead.id, "lost", lostReasonId, lostNotes),
      () => {
        setStage("lost");
        setLostModal(false);
        setLostReasonId("");
        setLostNotes("");
      },
    );
  }

  function submitEscalation() {
    run(
      () => escalateLeadAction(lead.id, escalationReason, escalationSeverity),
      () => {
        setEscalateModal(false);
        setEscalationReason("");
      },
    );
  }

  // Most recent message across every channel, for the Overview preview card.
  const latestMessage = useMemo(() => {
    const conv = data.messages.filter(
      (m) => m.channel === "facebook" || m.channel === "instagram" || m.channel === "whatsapp",
    );
    if (conv.length === 0) return null;
    return conv.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  }, [data.messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: identity + status/channel badges + close */}
      <div className="flex-none border-b border-line-soft px-5 pb-4 pt-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary-avatar text-[15px] font-bold text-primary">
            {lead.patientName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[17px] font-semibold text-clinic-ink">
              {lead.patientName}
            </div>
            <div className="font-mono text-[10.5px] text-ink-400">
              {lead.id}
              {lead.mrn ? ` · ${lead.mrn}` : ""}
            </div>
            {lead.chatLink && (
              <a
                href={lead.chatLink}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex text-[12px] font-semibold text-primary hover:underline"
              >
                {lead.platform === "instagram"
                  ? "Open Instagram DM"
                  : lead.platform === "whatsapp"
                    ? "Open WhatsApp Conversation"
                    : lead.platform === "facebook"
                      ? "Open Facebook Conversation"
                      : "Open Conversation"}
              </a>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge style={STAGE_META[stage]} />
              {pm && (
                <Badge style={{ label: CHANNEL_LABEL[lead.platform], bg: pm.bg, fg: pm.fg }} />
              )}
              {lead.escalated && <Badge className="bg-danger-bg text-danger">⚑ Escalated</Badge>}
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="flex-none rounded-control border border-line px-2.5 py-2 text-[13px] leading-none text-ink-600 hover:bg-line-faint"
            >
              ✕
            </button>
          ) : (
            <Link
              href="/leads"
              aria-label="Close"
              className="flex-none rounded-control border border-line px-2.5 py-2 text-[13px] leading-none text-ink-600 hover:bg-line-faint"
            >
              ✕
            </Link>
          )}
        </div>

        {/* Action row */}
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setTab("Booking")}
            className="flex-1 rounded-control bg-primary px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-hover"
          >
            Book appointment
          </button>
          {lead.escalated ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => clearLeadEscalationAction(lead.id))}
              className="rounded-control border border-danger/30 bg-danger-bg px-3.5 py-2 text-[12.5px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              Un-Escalate
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setEscalateModal(true)}
              className="rounded-control border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-700 hover:border-primary hover:text-primary disabled:opacity-60"
            >
              Escalate
            </button>
          )}
          <button
            onClick={() => setTab("Conversation")}
            className="rounded-control border border-line px-3.5 py-2 text-[12.5px] font-medium text-ink-700 hover:border-primary hover:text-primary"
          >
            Reply
          </button>
        </div>
        {(actionError || actionOk) && (
          <div
            className={
              "mt-2 rounded-control px-3 py-2 text-[12px] font-medium " +
              (actionError ? "bg-danger-bg text-danger" : "bg-[#ecfdf3] text-success")
            }
          >
            {actionError ?? actionOk}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-none items-center gap-1 overflow-x-auto border-b border-line-soft px-3">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "whitespace-nowrap border-b-2 px-3 py-2.5 text-[12.5px] font-medium transition-colors " +
              (tab === t
                ? "border-primary text-primary"
                : "border-transparent text-ink-500 hover:text-ink-700")
            }
          >
            {t}
            {t === "Comments" && data.comments.length > 0 ? ` ${data.comments.length}` : ""}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "Overview" && (
          <div className="flex flex-col gap-5 p-5">
            {/* Lead details */}
            <section>
              <SectionLabel>Lead details</SectionLabel>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                <DetailField label="Phone" value={lead.phone} />
                <DetailField label="Gender" value={<span className="capitalize">{lead.gender ?? "—"}</span>} />
                <DetailField label="Service" value={lead.serviceName ?? specialtyName(lead.specialtyId)} />
                <DetailField label="Doctor" value={lead.doctorName ?? doctorName(lead.doctorId)} />
                <DetailField label="Branch" value={lead.branch ?? "—"} />
                <DetailField label="Patient type" value={<span className="capitalize">{lead.patientType}</span>} />
                <DetailField label="Campaign" value={campaignName(lead.campaignId)} />
                <DetailField label="Heard via" value={pm ? pm.label : sourceName(lead.sourceId)} />
                {stage === "lost" && <DetailField label="Lost reason" value={lead.lostReason ?? "—"} />}
              </div>
            </section>

            {/* Change status */}
            <section>
              <SectionLabel>Change status</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {STATUS_PILL_ORDER.map((s) => {
                  const active = s === stage;
                  return (
                    <button
                      key={s}
                      onClick={() => changeStage(s)}
                      disabled={pending}
                      className={
                        "rounded-pill border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors disabled:opacity-60 " +
                        (active && s === "lost"
                          ? "border-danger/40 bg-danger-bg text-danger"
                          : active
                          ? "border-success-strong bg-success/5 text-success"
                          : s === "lost"
                            ? "border-danger/20 bg-panel text-danger hover:bg-danger-bg"
                          : "border-line bg-panel text-ink-600 hover:border-primary hover:text-primary")
                      }
                    >
                      {STATUS_PILL_LABEL[s]}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Tags */}
            <section>
              <SectionLabel>Tags</SectionLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.availableTags.map((tag) => {
                  const selected = tags.includes(tag.label);
                  return (
                  <span
                    key={tag.id}
                    className={
                      "inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11.5px] font-medium " +
                      (selected
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-line bg-panel text-ink-500")
                    }
                  >
                    <button
                      type="button"
                      disabled={pending}
                      aria-pressed={selected}
                      onClick={() => toggleTag(tag.label)}
                      className="disabled:opacity-60"
                    >
                      {tag.label}
                    </button>
                  </span>
                  );
                })}
                {data.availableTags.length === 0 && (
                  <span className="text-[12px] text-ink-400">No configured tags.</span>
                )}
              </div>
            </section>

            {/* Latest message */}
            <section>
              <SectionLabel>Latest message</SectionLabel>
              {latestMessage ? (
                <div className="rounded-card border border-line p-3.5">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11.5px] font-semibold text-ink-700">
                      {latestMessage.direction === "outgoing"
                        ? (latestMessage.authorName ?? "You")
                        : lead.patientName}
                    </span>
                    <span className="text-[10.5px] text-ink-400">{formatDateTime(latestMessage.createdAt)}</span>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-ink-700">{latestMessage.body}</p>
                  <button
                    onClick={() => setTab("Conversation")}
                    className="mt-2 text-[12px] font-semibold text-primary hover:underline"
                  >
                    Open conversation →
                  </button>
                </div>
              ) : (
                <div className="rounded-card border border-line p-3.5 text-[12px] text-ink-400">
                  No messages yet.
                </div>
              )}
            </section>

            {data.attribution && <AttributionSection attribution={data.attribution} />}
            <IdentitySection lead={lead} />
          </div>
        )}

        {tab === "Conversation" && (
          <MessageThread
            messages={data.messages.filter(
              (m) => m.channel === "facebook" || m.channel === "instagram" || m.channel === "whatsapp",
            )}
            emptyHint="Messenger, Instagram & WhatsApp messages will appear here once integrations are connected."
          />
        )}

        {tab === "Comments" && <CommentsPanel comments={data.comments} />}

        {tab === "Notes" && <NotesTab leadId={lead.id} note={lead.note} />}

        {tab === "Follow-Up" && (
          <FollowUpPanel
            lead={lead}
            pending={pending}
            onSchedule={(workflowType, dueAt, notes) =>
              run(() => scheduleFollowUpAction(lead.id, workflowType, dueAt, notes))
            }
            onComplete={(followUpId, outcome) =>
              run(() => completeFollowUpAction(lead.id, followUpId, outcome))
            }
            onSnooze={(followUpId) =>
              run(() => snoozeFollowUpAction(lead.id, followUpId, 1))
            }
            onMarkLost={() => setLostModal(true)}
          />
        )}

        {tab === "Booking" && <BookingTab lead={lead} bookings={data.bookings} catalog={data.bookingCatalog} />}

        {tab === "Payments" && <PaymentsTab financials={data.financials} error={data.financialsError} />}

        {tab === "Log" && (
          <div className="flex flex-col gap-7 p-5">
            <div>
              <SectionLabel>Timeline</SectionLabel>
              <TimelinePanel events={data.timeline} embedded />
            </div>
            {data.escalations.length > 0 && (
              <div>
                <SectionLabel>Escalations</SectionLabel>
                <EscalationsPanel escalations={data.escalations} embedded />
              </div>
            )}
            {data.duplicateGroups.length > 0 && (
              <div>
                <SectionLabel>Duplicates</SectionLabel>
                <DuplicatesPanel groups={data.duplicateGroups} leadId={lead.id} embedded />
              </div>
            )}
          </div>
        )}
      </div>
      {lostModal && (
        <Modal title="Mark Lead as Lost" onClose={() => setLostModal(false)}>
          <label className="block text-[12px] font-semibold text-ink-600">
            Lost reason
            <select
              value={lostReasonId}
              onChange={(e) => setLostReasonId(e.target.value)}
              className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
            >
              <option value="">Choose a reason</option>
              {data.lostReasons.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </label>
          <label className="mt-3 block text-[12px] font-semibold text-ink-600">
            Details
            <textarea
              value={lostNotes}
              onChange={(e) => setLostNotes(e.target.value)}
              className="mt-1 min-h-[88px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px]"
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-control border border-line px-3 py-2 text-[12px]" onClick={() => setLostModal(false)}>
              Cancel
            </button>
            <button
              disabled={pending || !lostReasonId}
              onClick={submitLost}
              className="rounded-control bg-danger px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              Mark Lost
            </button>
          </div>
        </Modal>
      )}
      {escalateModal && (
        <Modal title="Escalate Lead" onClose={() => setEscalateModal(false)}>
          <label className="block text-[12px] font-semibold text-ink-600">
            Reason
            <textarea
              autoFocus
              value={escalationReason}
              onChange={(e) => setEscalationReason(e.target.value)}
              className="mt-1 min-h-[96px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px]"
            />
          </label>
          <label className="mt-3 block text-[12px] font-semibold text-ink-600">
            Severity
            <select
              value={escalationSeverity}
              onChange={(e) => setEscalationSeverity(e.target.value)}
              className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-control border border-line px-3 py-2 text-[12px]" onClick={() => setEscalateModal(false)}>
              Cancel
            </button>
            <button
              disabled={pending || escalationReason.trim().length === 0}
              onClick={submitEscalation}
              className="rounded-control bg-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              Escalate
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-[420px] rounded-card bg-panel p-4 shadow-toast">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[16px] font-semibold text-clinic-ink">{title}</h2>
          <button onClick={onClose} className="rounded-control border border-line px-2 py-1 text-[12px] text-ink-500">
            x
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{children}</div>
  );
}

/**
 * Where the lead came from. First touch answers "which ad won this lead" and is
 * never overwritten; latest touch shows what brought them back.
 */
function AttributionSection({ attribution }: { attribution: LeadAttribution }) {
  const a = attribution;
  const first = a.firstAdName ?? a.firstCampaign ?? a.firstReferralSource ?? a.firstSource;
  const latest = a.latestAdName ?? a.latestCampaign ?? a.latestReferralSource ?? a.latestSource;
  const returned = a.touchCount > 1 && latest && latest !== first;

  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[11px] text-ink-400">Attribution</div>
      <div className="divide-y divide-line-faint">
        <DetailRow label="First touch" value={first ?? "—"} />
        {a.firstTouchAt && <DetailRow label="Entered on" value={formatDate(a.firstTouchAt)} />}
        {returned && <DetailRow label="Latest touch" value={latest} />}
        {a.firstReferralCode && <DetailRow label="Referral code" value={a.firstReferralCode} />}
        {a.touchCount > 1 && <DetailRow label="Ad touches" value={a.touchCount} />}
      </div>

      {(a.firstAdId || a.latestAdId) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-400 hover:text-ink-600">Technical details</summary>
          <div className="mt-1 divide-y divide-line-faint">
            {a.firstAdId && (
              <DetailRow label="First ad ID" value={<span className="font-mono text-[10.5px]">{a.firstAdId}</span>} />
            )}
            {a.latestAdId && a.latestAdId !== a.firstAdId && (
              <DetailRow label="Latest ad ID" value={<span className="font-mono text-[10.5px]">{a.latestAdId}</span>} />
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/** Platform identifiers, kept behind a disclosure so they do not crowd the profile. */
function IdentitySection({ lead }: { lead: Lead }) {
  if (!lead.platformId && !lead.chatLink) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[11px] text-ink-400 hover:text-ink-600">Identity & technical</summary>
      <div className="mt-1 divide-y divide-line-faint">
        {lead.platformId && (
          <DetailRow
            label={lead.platform === "instagram" ? "Instagram ID" : "Platform ID"}
            value={<span className="font-mono text-[10.5px] break-all">{lead.platformId}</span>}
          />
        )}
        {lead.chatLink && (
          <DetailRow
            label="Chat"
            value={
              <a href={lead.chatLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                Open inbox ↗
              </a>
            }
          />
        )}
      </div>
    </details>
  );
}

function FollowUpPanel({
  lead,
  pending,
  onSchedule,
  onComplete,
  onSnooze,
  onMarkLost,
}: {
  lead: Lead;
  pending: boolean;
  onSchedule: (workflowType: string, dueAt: string, notes?: string) => void;
  onComplete: (followUpId?: string, outcome?: string) => void;
  onSnooze: (followUpId?: string) => void;
  onMarkLost: () => void;
}) {
  const f = lead.followUp;
  const [workflowType, setWorkflowType] = useState(f.workflowType ?? "follow_up");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const missed = f.status === "missed";
  const scheduled = f.status !== "none" || !!f.nextDate || !!f.reason;

  const dueText = missed
    ? "Overdue"
    : f.nextDate
      ? `Due ${formatDate(f.nextDate)}`
      : "No date set";

  return (
    <div className="flex flex-col gap-5 p-5">
      {scheduled ? (
        <div
          className={
            "rounded-card border p-4 " +
            (missed ? "border-danger/40 bg-danger-bg" : "border-[#fedf89] bg-[#fffaeb]")
          }
        >
          <div
            className={
              "text-[11px] font-semibold uppercase tracking-wide " + (missed ? "text-danger" : "text-warn")
            }
          >
            Current follow-up
          </div>
          <div className="mt-1.5 text-[16px] font-semibold text-ink-900">{f.reason ?? "Follow-up"}</div>
          <div className="mt-1 text-[12.5px] text-ink-500">
            {dueText}
            {f.owner ? ` · ${f.owner}` : ""}
          </div>
        </div>
      ) : (
        <EmptyState
          icon="↻"
          title="No follow-up scheduled"
          hint="Schedule a follow-up to keep this lead moving through the pipeline."
        />
      )}

      <div>
        <SectionLabel>Schedule next</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          <select
            value={workflowType}
            onChange={(e) => setWorkflowType(e.target.value)}
            className="h-9 rounded-control border border-line bg-panel px-2 text-[12.5px] text-ink-700"
          >
            <option value="follow_up">Regular</option>
            <option value="post_op">Post-op</option>
          </select>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="h-9 rounded-control border border-line bg-panel px-2 text-[12.5px] text-ink-700"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason or moderator note"
          className="mt-2 min-h-[76px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px] text-ink-700"
        />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            disabled={pending || !dueAt}
            onClick={() => onSchedule(workflowType, dueAt, notes)}
            className="rounded-control bg-primary px-3 py-2 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            Schedule next
          </button>
        </div>
      </div>

      <div>
        <SectionLabel>Actions</SectionLabel>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="Completion outcome"
            className="h-10 rounded-control border border-line bg-panel px-2.5 text-[12.5px] text-ink-700"
          />
          <button
            type="button"
            disabled={pending || !scheduled}
            onClick={() => onComplete(f.id, outcome)}
            className="rounded-control border border-success-strong/40 bg-success/5 px-3 py-2 text-[12.5px] font-semibold text-success hover:bg-success/10 disabled:opacity-60"
          >
            Mark done
          </button>
          <button
            type="button"
            disabled={pending || !scheduled}
            onClick={() => onSnooze(f.id)}
            className="rounded-control border border-line bg-panel px-3 py-2 text-[12.5px] font-semibold text-ink-700 hover:border-primary hover:text-primary disabled:opacity-60"
          >
            Snooze 1 day
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onMarkLost}
            className="rounded-control border border-danger/30 bg-danger-bg px-3 py-2 text-[12.5px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
          >
            Mark lost
          </button>
        </div>
      </div>
    </div>
  );
}

/** Parse the target stage out of a `Stage → qualified …` label. */
function stageOf(label: string): PipelineStage | undefined {
  const stage = label.match(/→\s*([a-z_]+)/)?.[1];
  return stage && stage in STAGE_DOT ? (stage as PipelineStage) : undefined;
}

/** Colored timeline dot: stage changes take their target-stage color, all
 *  other events take their per-kind color. */
function eventDotColor(e: TimelineEvent): string {
  if (e.kind === "stage_change") {
    const stage = stageOf(e.label);
    if (stage) return STAGE_DOT[stage];
  }
  return KIND_DOT[e.kind];
}

/** Prettify a stage-change label as `Status → Qualified`. */
function eventLabel(e: TimelineEvent): string {
  if (e.kind === "stage_change") {
    const stage = stageOf(e.label);
    if (stage) return e.label.replace(/^Stage → [a-z_]+/, `Status → ${STATUS_PILL_LABEL[stage]}`);
  }
  return e.label;
}

function TimelinePanel({ events, embedded }: { events: TimelineEvent[]; embedded?: boolean }) {
  if (events.length === 0) return <EmptyState title="No timeline events" />;
  return (
    <div className={embedded ? "" : "p-5"}>
      <div className="relative ml-1 border-l border-line-soft pl-6">
        {events.map((e) => (
          <div key={e.id} className="relative pb-6 last:pb-0">
            <span
              className="absolute -left-[30px] top-[3px] h-3 w-3 rounded-full ring-4 ring-panel"
              style={{ backgroundColor: eventDotColor(e) }}
            />
            <div className="text-[13.5px] font-semibold text-ink-900">{eventLabel(e)}</div>
            <div className="mt-0.5 text-[12px] text-ink-400">
              {formatDateTime(e.at)}
              {e.actor ? ` · ${e.actor}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DuplicatesPanel({
  groups,
  leadId,
  embedded,
}: {
  groups: LeadDetailData["duplicateGroups"];
  leadId: string;
  embedded?: boolean;
}) {
  if (groups.length === 0)
    return <EmptyState icon="⧉" title="No suspected duplicates" hint="This lead has no matching records." />;
  return (
    <div className={"flex flex-col gap-3 " + (embedded ? "" : "p-4")}>
      {groups.map((g) => (
        <div key={g.id} className="rounded-card border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-pill bg-[#fffaeb] px-2 py-0.5 text-[11px] font-semibold text-warn">
              {Math.round(g.confidence * 100)}% match
            </span>
            <span className="text-[12px] text-ink-500">{g.reason}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {g.members.map((mem) => (
              <Link
                key={mem.id}
                href={`/leads/${mem.id}`}
                className={
                  "rounded-lg border p-2.5 text-[12px] " +
                  (mem.id === leadId
                    ? "border-primary bg-primary-soft"
                    : "border-line hover:border-primary")
                }
              >
                <div className="font-semibold text-ink-900">{mem.name}</div>
                <div className="text-ink-400">{mem.phone}</div>
                <div className="font-mono text-[10.5px] text-ink-400">{mem.id}</div>
              </Link>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <DuplicateActionButton
              action={() => resolveDuplicateAction(g.id, "merged")}
              label="Merge duplicate"
              pendingLabel="Merging..."
            />
            <DuplicateActionButton
              action={() => resolveDuplicateAction(g.id, "linked")}
              label="Link identities"
              pendingLabel="Saving..."
            />
            <DuplicateActionButton
              action={() => resolveDuplicateAction(g.id, "dismissed")}
              label="Not a duplicate"
              pendingLabel="Saving..."
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function DuplicateActionButton({
  action,
  label,
  pendingLabel,
}: {
  action: () => Promise<void>;
  label: string;
  pendingLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await action();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Action failed.");
            }
          })
        }
        className="rounded-control border border-line bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-ink-600 hover:border-primary hover:text-primary disabled:opacity-60"
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="max-w-[160px] text-[10px] text-danger">{error}</span>}
    </span>
  );
}

function EscalationsPanel({ escalations, embedded }: { escalations: Escalation[]; embedded?: boolean }) {
  if (escalations.length === 0)
    return <EmptyState icon="⚑" title="No escalations" hint="Raise an escalation if this lead needs auditor attention." />;
  return (
    <div className={"flex flex-col gap-3 " + (embedded ? "" : "p-4")}>
      {escalations.map((e) => (
        <div key={e.id} className="rounded-card border border-line p-3">
          <div className="mb-2 flex items-center gap-2">
            <Badge style={SEVERITY_META[e.severity]} />
            <span className="text-[13px] font-semibold text-ink-900">{e.reason}</span>
            <span
              className={
                "ml-auto rounded-pill px-2 py-0.5 text-[11px] font-semibold capitalize " +
                (e.status === "resolved"
                  ? "bg-[#ecfdf3] text-success"
                  : e.status === "assigned"
                    ? "bg-primary-soft text-primary"
                    : "bg-danger-bg text-danger")
              }
            >
              {e.status}
            </span>
          </div>
          <div className="text-[11.5px] text-ink-400">
            Raised by {e.raisedBy} · {formatDateTime(e.createdAt)}
            {e.assignedTo ? ` · assigned to ${e.assignedTo}` : ""}
          </div>
          {e.status !== "resolved" && (
            <div className="mt-2.5 flex justify-end">
              <EscalationResolutionControls
                onReturn={returnEscalationAction.bind(null, e.id)}
                onResolve={resolveEscalationAction.bind(null, e.id)}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
