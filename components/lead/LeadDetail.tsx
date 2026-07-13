"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  Booking,
  Comment,
  DuplicateGroup,
  Escalation,
  Lead,
  LeadAttribution,
  FollowUpPlan,
  Message,
  PipelineStage,
  Platform,
  ReferenceOption,
  TimelineEvent,
  TreatingDoctorAssignment,
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
  sourceName,
  specialtyName,
} from "@/lib/data/reference";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  clearLeadEscalationAction,
  addFollowUpProgramAction,
  completeFollowUpAction,
  escalateLeadAction,
  scheduleFollowUpAction,
  setLeadTagsAction,
  snoozeFollowUpAction,
  updateLeadStageAction,
  markLeadReadAction,
  updateLeadProfileAction,
} from "@/app/(crm)/leads/actions";
import {
  resolveEscalationAction,
  returnEscalationAction,
} from "@/app/(crm)/escalations/actions";
import { resolveDuplicateAction } from "@/app/(crm)/duplicates/actions";
import { EscalationResolutionControls } from "@/components/queues/EscalationResolutionControls";
import { mergeMessages } from "@/lib/messages/merge";
import { deriveLeadBookingSummary } from "@/lib/booking/leadSummary";

const TABS = [
  "Overview",
  "Messenger / IG DM",
  "WhatsApp",
  "Comments",
  "Notes",
  "Follow-Up",
  "Booking",
  "Payments",
  "Timeline",
] as const;
type Tab = (typeof TABS)[number];
type LoadableTab = "Overview" | "Messenger / IG DM" | "WhatsApp" | "Comments" | "Follow-Up" | "Booking" | "Payments" | "Timeline";

const TAB_CACHE_TTL_MS = 5 * 60_000;
const MAX_TAB_CACHE_ENTRIES = 100;
const tabCache = new Map<string, { data: Partial<LeadDetailData>; cachedAt: number }>();

function readCachedTab(key: string): Partial<LeadDetailData> | null {
  const cached = tabCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt > TAB_CACHE_TTL_MS) {
    tabCache.delete(key);
    return null;
  }
  // Refresh insertion order so the bounded cache evicts the least recently
  // used entry instead of data the user is actively revisiting.
  tabCache.delete(key);
  tabCache.set(key, cached);
  return cached.data;
}

function cacheTab(key: string, data: Partial<LeadDetailData>): void {
  tabCache.delete(key);
  tabCache.set(key, { data, cachedAt: Date.now() });
  while (tabCache.size > MAX_TAB_CACHE_ENTRIES) {
    const oldest = tabCache.keys().next().value as string | undefined;
    if (!oldest) break;
    tabCache.delete(oldest);
  }
}

function mergeTabPayload(current: LeadDetailData, payload: Partial<LeadDetailData>): LeadDetailData {
  return {
    ...current,
    ...payload,
    messages: payload.messages ? mergeMessages(current.messages, payload.messages) : current.messages,
  };
}

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
  new: "New Lead",
  qualified: "Qualified",
  follow_up: "Follow-Up",
  post_op: "Post-Op Follow-Up",
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
  followUpPlan: FollowUpPlan | null;
  whatsappConfigured: boolean;
  availableTags: ReferenceOption[];
  lostReasons: ReferenceOption[];
  escalationReasons: Array<ReferenceOption & { severity?: string }>;
  treatingDoctors: TreatingDoctorAssignment[];
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

export function LeadDetail({ data: initialData, onClose }: { data: LeadDetailData; onClose?: () => void }) {
  const [data, setData] = useState<LeadDetailData>(initialData);
  const { lead } = data;
  const router = useRouter();
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
  const [confirmStage, setConfirmStage] = useState<PipelineStage | null>(null);
  const [lostReasonId, setLostReasonId] = useState("");
  const [lostNotes, setLostNotes] = useState("");
  const lostReasonIsOther = data.lostReasons.find((reason) => reason.id === lostReasonId)?.label.trim().toLowerCase() === "other";
  const [escalateModal, setEscalateModal] = useState(false);
  const [escalationReasonId, setEscalationReasonId] = useState("");
  const [escalationReason, setEscalationReason] = useState("");
  const [escalationSeverity, setEscalationSeverity] = useState("medium");
  const [loadedTabs, setLoadedTabs] = useState<Set<string>>(() => new Set());
  const [loadingTab, setLoadingTab] = useState<string | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [serviceSearch, setServiceSearch] = useState("");
  const [doctorSearch, setDoctorSearch] = useState("");

  const pm = PLATFORM_META[lead.platform];

  useEffect(() => {
    if (requestedTab && TABS.includes(requestedTab as Tab)) setTab(requestedTab as Tab);
  }, [requestedTab]);

  useEffect(() => {
    const loadable: LoadableTab[] = ["Overview", "Messenger / IG DM", "WhatsApp", "Comments", "Follow-Up", "Booking", "Payments", "Timeline"];
    if (!loadable.includes(tab as LoadableTab)) return;
    if (loadedTabs.has(tab)) return;
    const cacheKey = `${lead.id}:${tab}`;
    const cached = readCachedTab(cacheKey);
    if (cached) {
      // Show cached data immediately, then continue to the network request so
      // newly ingested messages and receipt metadata replace stale copies.
      setData((current) => mergeTabPayload(current, cached));
    }

    let cancelled = false;
    setLoadingTab(tab);
    setTabError(null);
    fetch(`/api/leads/${encodeURIComponent(lead.id)}/tab?tab=${encodeURIComponent(tab)}`, {
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error ?? "Could not load this tab.");
        return payload as Partial<LeadDetailData>;
      })
      .then((payload) => {
        if (cancelled) return;
        cacheTab(cacheKey, payload);
        setData((current) => mergeTabPayload(current, payload));
        setLoadedTabs((current) => new Set(current).add(tab));
      })
      .catch((err) => {
        if (!cancelled) setTabError(err instanceof Error ? err.message : "Could not load this tab.");
      })
      .finally(() => {
        if (!cancelled) setLoadingTab(null);
      });
    return () => {
      cancelled = true;
    };
  }, [lead.id, loadedTabs, tab]);

  function invalidateTab(nextTab: LoadableTab) {
    tabCache.delete(`${lead.id}:${nextTab}`);
    setLoadedTabs((current) => {
      const next = new Set(current);
      next.delete(nextTab);
      return next;
    });
  }

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
    setConfirmStage(next);
  }

  function submitStageChange() {
    if (!confirmStage) return;
    const next = confirmStage;
    run(() => updateLeadStageAction(lead.id, next), () => {
      setStage(next);
      setConfirmStage(null);
      invalidateTab("Follow-Up");
      router.refresh();
    });
  }

  function toggleTag(tag: string) {
    if (pending) return;
    const previous = tags;
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setTags(next);
    setData((current) => ({ ...current, lead: { ...current.lead, tags: next } }));
    startTransition(async () => {
      setActionError(null);
      setActionOk(null);
      const ids = data.availableTags.filter((t) => next.includes(t.label)).map((t) => t.id);
      try {
        const result = await setLeadTagsAction(lead.id, ids);
        if (result.error) {
          setTags(previous);
          setData((current) => ({ ...current, lead: { ...current.lead, tags: previous } }));
          setActionError(result.error);
          return;
        }
        const canonical = result.tags ?? next;
        setTags(canonical);
        setData((current) => ({ ...current, lead: { ...current.lead, tags: canonical } }));
        setActionOk(result.ok);
        router.refresh();
      } catch (err) {
        setTags(previous);
        setData((current) => ({ ...current, lead: { ...current.lead, tags: previous } }));
        setActionError(err instanceof Error ? err.message : "Tags could not be saved.");
      }
    });
  }

  function markRead() {
    run(() => markLeadReadAction(lead.id), () => {
      setData((current) => ({
        ...current,
        lead: { ...current.lead, unread: false, incomingUnanswered: false, attentionMessage: undefined, attentionTab: undefined },
      }));
    });
  }

  function submitLost() {
    run(
      () => updateLeadStageAction(lead.id, "lost", lostReasonId, lostNotes),
      () => {
        setStage("lost");
        setLostModal(false);
        setLostReasonId("");
        setLostNotes("");
        router.refresh();
      },
    );
  }

  function submitEscalation() {
    const selected = data.escalationReasons.find((r) => r.id === escalationReasonId);
    const reason = [selected?.label, escalationReason.trim()].filter(Boolean).join(": ");
    run(
      () => escalateLeadAction(lead.id, reason, escalationSeverity),
      () => {
        setEscalateModal(false);
        setEscalationReasonId("");
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
      {/* Compact fixed header: identity and the three high-frequency actions. */}
      <div className="flex-none border-b border-line-soft bg-panel px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5 sm:flex-nowrap">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary-avatar text-[12px] font-black text-primary">
            {lead.patientName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <div className="truncate font-display text-[14px] font-bold text-clinic-ink sm:text-[15px]">
              {lead.patientName}
              </div>
              <span className="hidden font-mono text-[10px] text-ink-400 sm:inline">{lead.id}</span>
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <span className={"font-mono text-[10.5px] font-bold " + (lead.mrn ? "text-ink-600" : "text-danger")}>
                {lead.mrn ? `MRN ${lead.mrn}` : "MRN"}
              </span>
              <Badge style={STAGE_META[stage]} />
              {pm && <span className="hidden sm:inline-flex"><Badge style={{ label: CHANNEL_LABEL[lead.platform], bg: pm.bg, fg: pm.fg }} /></span>}
              {lead.escalated && <span className="text-[10px] font-bold text-danger">⚑ Escalated</span>}
            </div>
          </div>
          <div className="flex w-full flex-none items-center justify-end gap-1.5 sm:w-auto">
            {lead.unread && (
              <button type="button" disabled={pending} onClick={markRead} className="rounded-control bg-primary px-2.5 py-2 text-[11px] font-bold text-white hover:bg-primary-hover disabled:opacity-60">
                ✓ <span className="hidden sm:inline">Read</span>
              </button>
            )}
            {lead.chatLink && (
              <a href={lead.chatLink} target="_blank" rel="noreferrer" aria-label="Open source conversation" className="rounded-control border border-primary/30 bg-primary-soft px-2.5 py-2 text-[11px] font-bold text-primary hover:border-primary">
                ↗ <span className="hidden lg:inline">Open chat</span>
              </a>
            )}
            <button onClick={() => setTab("Booking")} className="rounded-control bg-primary px-2.5 py-2 text-[11px] font-bold text-white hover:bg-primary-hover">
              + <span className="hidden md:inline">Book</span>
            </button>
            <button onClick={() => setTab("Payments")} className="rounded-control border border-line px-2.5 py-2 text-[11px] font-bold text-ink-700 hover:border-primary hover:text-primary">
              $ <span className="hidden lg:inline">Payment</span>
            </button>
            <button
              type="button"
              aria-label={lead.escalated ? "Clear escalation" : "Escalate lead"}
              disabled={pending}
              onClick={() => lead.escalated ? run(() => clearLeadEscalationAction(lead.id)) : setEscalateModal(true)}
              className={"min-h-10 min-w-11 rounded-md border px-3 py-2.5 text-[17px] font-black leading-none disabled:opacity-60 " + (lead.escalated ? "border-danger bg-danger text-white" : "border-danger/35 bg-danger-bg text-danger")}
            >
              ⚑
            </button>
          {onClose ? (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-control border border-line px-2.5 py-2 text-[12px] leading-none text-ink-600 hover:bg-line-faint"
            >
              ✕
            </button>
          ) : (
            <Link
              href="/leads"
              aria-label="Close"
              className="rounded-control border border-line px-2.5 py-2 text-[12px] leading-none text-ink-600 hover:bg-line-faint"
            >
              ✕
            </Link>
          )}
          </div>
        </div>
        {(actionError || actionOk) && (
          <div
            className={
              "mt-2 rounded-control px-3 py-1.5 text-[11px] font-medium " +
              (actionError ? "bg-danger-bg text-danger" : "bg-[#ecfdf3] text-success")
            }
          >
            {actionError ?? actionOk}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-none items-center gap-0.5 overflow-x-auto border-b border-line-soft bg-panel px-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "whitespace-nowrap border-b-2 px-2.5 py-2 text-[11.5px] font-semibold transition-colors " +
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
        {loadingTab === tab && (
          <div className="border-b border-line-soft bg-toolbar px-5 py-2 text-[12px] font-medium text-ink-500">
            Loading {tab}...
          </div>
        )}
        {tabError && (
          <div className="m-4 rounded-control bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger">
            {tabError}
          </div>
        )}
        {tab === "Overview" && (
          <div className="flex flex-col gap-4 bg-slate-50/60 p-3 sm:p-5">
            <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
              <div className="section-hero border-b border-line px-4 py-3">
                <div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Lead at a glance</div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[18px] font-black text-ink-950">{lead.patientName}</div>
                  <div className="text-[11px] font-semibold text-ink-500">Created {formatDate(lead.createdAt)}</div>
                </div>
              </div>
              <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
                <div className="p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Patient record</div>
                  <div className="mt-2 text-[13px] font-bold text-ink-900">{lead.phone || "No phone"}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Care plan</div>
                  <div className="mt-2 text-[13px] font-bold text-ink-900">{lead.serviceNames?.join(", ") ?? lead.serviceName ?? specialtyName(lead.specialtyId)}</div>
                  <div className="mt-1 text-[11px] text-ink-500">{data.treatingDoctors.map((doctor) => doctor.doctorName).join(", ") || lead.doctorNames?.join(", ") || lead.doctorName || "Doctor not assigned"}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Next attention</div>
                  <div className={"mt-2 text-[13px] font-bold " + (lead.overdue ? "text-danger" : lead.incomingUnanswered ? "text-warn" : "text-success")}>
                    {lead.overdue ? "Reply is overdue" : lead.incomingUnanswered ? "Patient is waiting" : "No urgent action"}
                  </div>
                  <div className="mt-1 text-[11px] text-ink-500">{lead.bookingContext ?? (lead.followUp.nextDate ? `Follow-up ${formatDate(lead.followUp.nextDate)}` : "Review the latest conversation")}</div>
                </div>
                <div className="bg-slate-100/80 p-4">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">MRN</div>
                  <div className={"mt-2 font-mono text-[16px] font-black " + (lead.mrn ? "text-ink-800" : "text-danger")}>
                    {lead.mrn || "Missing"}
                  </div>
                  <div className="mt-1 text-[10.5px] text-ink-500">Clinic record identifier</div>
                </div>
              </div>
            </section>
            {lead.attentionMessage && (
              <button
                type="button"
                onClick={() => setTab(lead.attentionTab === "Log" ? "Timeline" : lead.attentionTab === "Messenger" ? "Messenger / IG DM" : (lead.attentionTab as Tab | undefined) ?? "Timeline")}
                className="rounded-control border border-amber-300 bg-amber-50 px-3 py-2 text-left text-[12.5px] font-semibold text-amber-900 hover:border-amber-500"
              >
                <span className="block text-[11px] uppercase text-amber-700">Escalation resolved</span>
                <span data-patient-content className="mt-0.5 block font-normal">{lead.attentionMessage}</span>
                <span className="mt-1 block text-[11px] text-primary">Open admin / auditor message →</span>
              </button>
            )}
            <details open className="group rounded-xl border border-line bg-panel shadow-sm">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <div><div className="text-[15px] font-black text-ink-900">Patient Info</div><div className="mt-0.5 text-[10.5px] text-ink-400">Identity, phones, MRN and care team · expanded for quick editing</div></div>
                <span className="text-[18px] text-ink-400 transition group-open:rotate-45">+</span>
              </summary>
              <form
                key={`profile-${lead.serviceIds?.join("-") ?? lead.serviceName ?? "none"}-${data.treatingDoctors.map((doctor) => doctor.doctorId).join("-") || lead.doctorId || "none"}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const formData = new FormData(event.currentTarget);
                  run(() => updateLeadProfileAction(lead.id, formData), () => {
                    const specialtyId = String(formData.get("specialtyId") ?? "") || undefined;
                    const serviceIds = formData.getAll("serviceIds").map(String);
                    const doctorIds = formData.getAll("doctorIds").map(String);
                    const services = data.bookingCatalog.services.filter((row) => serviceIds.includes(row.id));
                    const doctors = data.bookingCatalog.doctors.filter((row) => doctorIds.includes(row.id));
                    setData((current) => ({ ...current, lead: { ...current.lead, patientName: String(formData.get("name")), phone: String(formData.get("phone")), mrn: String(formData.get("mrn") ?? "") || undefined, gender: (String(formData.get("gender")) || undefined) as Lead["gender"], specialtyId, serviceName: services[0]?.nameEn, serviceIds: services.map((service) => service.id), serviceNames: services.map((service) => service.nameEn), doctorId: doctors[0]?.id, doctorName: doctors[0]?.nameEn, doctorNames: doctors.map((doctor) => doctor.nameEn) }, treatingDoctors: doctors.map((doctor, index) => ({ id: doctor.id, doctorId: doctor.id, doctorName: doctor.nameEn, specialtyId: doctor.specialtyId, primary: index === 0 })) }));
                    invalidateTab("Overview");
                  });
                }}
                className="grid gap-4 border-t border-line-soft bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-3"
              >
                <label className="rounded-lg border border-line-soft bg-panel p-3 text-[11.5px] font-semibold text-ink-500">Name<input data-patient-content name="name" required defaultValue={lead.patientName} className="calm-field mt-1.5 h-10 w-full px-3 text-[12.5px]" /></label>
                <div className="rounded-lg border border-line-soft bg-panel p-3 text-[11.5px] font-semibold text-ink-500"><label>Primary phone<input data-patient-content name="phone" required defaultValue={lead.phone} className="calm-field mt-1.5 h-10 w-full px-3 text-[12.5px]" /></label>{lead.phones && lead.phones.length > 1 && <div className="mt-2 flex flex-wrap gap-1">{lead.phones.filter((phone) => !phone.primary).map((phone) => <span key={phone.id} className="rounded-md bg-line-faint px-2 py-1 text-[10.5px] text-ink-700">{phone.label}: {phone.number}</span>)}</div>}<label className="mt-2 block text-[10.5px] text-ink-500">+ Add another phone<input name="additionalPhone" placeholder="Optional additional number" className="calm-field mt-1 h-9 w-full px-3 text-[11.5px]" /></label></div>
                <label className="rounded-lg border border-line-soft bg-panel p-3 text-[11.5px] font-semibold text-ink-500">MRN <span className="font-normal text-ink-400">(clinic record)</span><input name="mrn" inputMode="numeric" pattern="\d{1,9}" minLength={1} maxLength={9} defaultValue={lead.mrn ?? ""} placeholder="1–9 digits" className="calm-field mt-1.5 h-10 w-full px-3 font-mono text-[12.5px]" /><span className="mt-1.5 block text-[10px] font-normal text-ink-400">A repeated MRN opens the identity-link review.</span></label>
                <label className="text-[11.5px] font-semibold text-ink-500">Gender<select name="gender" defaultValue={lead.gender ?? ""} className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2.5 text-[12.5px]"><option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option></select></label>
                <div className="text-[11.5px] font-semibold text-ink-500"><span>Main specialty + add-ons</span><select name="specialtyId" defaultValue={lead.specialtyId ?? ""} className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2.5 text-[12.5px]"><option value="">Choose main specialty</option>{data.bookingCatalog.specialties.map((row) => <option key={row.id} value={row.id}>{row.nameEn}</option>)}</select><div className="mt-1 max-h-20 overflow-auto rounded-control border border-line-soft bg-white p-1.5">{data.bookingCatalog.specialties.map((row)=><label key={row.id} className="flex items-center gap-2 py-0.5 text-[10.5px] font-medium"><input type="checkbox" name="specialtyIds" value={row.id} defaultChecked={data.treatingDoctors.some((d)=>d.specialtyId===row.id && row.id!==lead.specialtyId)}/>Add-on · {row.nameEn}</label>)}</div></div>
                <div className="rounded-lg border border-line-soft bg-panel p-3 text-[11.5px] font-semibold text-ink-500"><span>Services</span><input type="search" value={serviceSearch} onChange={(e)=>setServiceSearch(e.target.value)} placeholder="Type to filter services…" className="calm-field mt-1.5 h-9 w-full px-2.5 text-[11.5px]"/><div className="mt-1.5 max-h-32 overflow-auto border border-line bg-panel p-2">{data.bookingCatalog.services.filter((service)=>service.nameEn.toLowerCase().includes(serviceSearch.trim().toLowerCase())).map((service) => <label key={service.id} className="flex items-center gap-2 py-1 text-[11.5px] font-medium text-ink-700"><input type="checkbox" name="serviceIds" value={service.id} defaultChecked={lead.serviceIds?.includes(service.id) || (!lead.serviceIds?.length && lead.serviceName === service.nameEn)} />{service.nameEn}</label>)}</div></div>
                <div className="rounded-lg border border-line-soft bg-panel p-3 text-[11.5px] font-semibold text-ink-500"><span>Treating doctors</span><input type="search" value={doctorSearch} onChange={(e)=>setDoctorSearch(e.target.value)} placeholder="Type to filter doctors…" className="calm-field mt-1.5 h-9 w-full px-2.5 text-[11.5px]"/><div className="mt-1.5 max-h-32 overflow-auto border border-line bg-panel p-2">{data.bookingCatalog.doctors.filter((doctor)=>doctor.nameEn.toLowerCase().includes(doctorSearch.trim().toLowerCase())).map((doctor) => <label key={doctor.id} className="flex items-center gap-2 py-1 text-[11.5px] font-medium text-ink-700"><input type="checkbox" name="doctorIds" value={doctor.id} defaultChecked={data.treatingDoctors.some((row) => row.doctorId === doctor.id) || (!data.treatingDoctors.length && lead.doctorId === doctor.id)} />{doctor.nameEn}</label>)}</div></div>
                <div className="md:col-span-2 xl:col-span-3 flex justify-end"><button disabled={pending || !data.bookingCatalog.configured} className="rounded-control bg-primary px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-50">{pending ? "Saving..." : "Save patient information"}</button></div>
              </form>
            </details>
            {(lead.linkedLeads?.length || lead.familyMembers?.length) ? (
              <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
                <SectionLabel>Family Tree & linked records</SectionLabel>
                <div className="grid gap-3 md:grid-cols-2">
                  <div><div className="mb-2 text-[10px] font-black uppercase tracking-wide text-primary">Same patient</div><div className="flex flex-col gap-2">{lead.linkedLeads?.filter((member) => member.relationship === "same_patient").map((member) => <Link key={member.id} href={`/leads/${member.id}`} className="border-s-4 border-primary bg-primary-soft/40 p-3 text-[12px]"><b className="text-ink-900">{member.name}</b><span className="ms-2 font-mono text-[10px] text-ink-400">{member.id}</span><div className="mt-0.5 text-ink-600">{member.phone}</div><div className="mt-1 text-[10.5px] font-semibold text-primary">Messages and history are retained across both records →</div></Link>)}{!lead.linkedLeads?.some((member) => member.relationship === "same_patient") && <div className="text-[11px] text-ink-400">No linked patient records.</div>}</div></div>
                  <div><div className="mb-2 text-[10px] font-black uppercase tracking-wide text-teal-700">Shared phone · possible family</div><div className="flex flex-col gap-2">{lead.familyMembers?.map((member) => <Link key={`${member.id}-${member.sharedPhone}`} href={`/leads/${member.id}`} className="border-s-4 border-teal-500 bg-teal-50 p-3 text-[12px]"><b className="text-ink-900">{member.name}</b><span className="ms-2 font-mono text-[10px] text-ink-400">{member.id}</span><div className="mt-0.5 text-ink-600">{member.phone}</div></Link>)}{!lead.familyMembers?.length && <div className="text-[11px] text-ink-400">No other patient currently shares these phone numbers.</div>}</div></div>
                </div>
              </section>
            ) : null}
            {/* Lead details */}
            <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
              <SectionLabel>Lead context</SectionLabel>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                <DetailField label="Patient type" value={<span className="capitalize">{lead.patientType}</span>} />
                <DetailField label="Campaign" value={campaignName(lead.campaignId)} />
                <DetailField label="Heard via" value={lead.sourceLabel ?? (pm ? pm.label : sourceName(lead.sourceId))} />
                <DetailField label="Branch" value={lead.branch ?? "—"} />
                {stage === "lost" && <DetailField label="Lost reason" value={lead.lostReason ?? "—"} />}
              </div>
            </section>

            {/* Change status */}
            <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
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
                          : active && s === "booked"
                            ? "border-primary bg-primary-soft text-primary ring-2 ring-primary/10"
                          : active
                          ? "border-success-strong bg-success/5 text-success"
                          : s === "booked"
                            ? "border-primary/25 bg-panel text-primary hover:border-primary hover:bg-primary-soft"
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
            <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
              <SectionLabel>Tags</SectionLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.availableTags.map((tag) => {
                  const selected = tags.includes(tag.label);
                  return (
                  <span
                    key={tag.id}
                    className={
                      "inline-flex items-center gap-1 rounded-pill border px-2.5 py-1 text-[11.5px] font-medium " +
                      (selected ? "" : "border-line bg-panel text-ink-500")
                    }
                    style={selected ? { borderColor: `${tag.color ?? "#2f6fed"}55`, backgroundColor: `${tag.color ?? "#2f6fed"}18`, color: tag.color ?? "#2f6fed" } : undefined}
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
            </div>

            {/* Latest message */}
            <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
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
                    onClick={() => setTab("Messenger / IG DM")}
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

        {tab === "Messenger / IG DM" && (
          <MessageThread
            messages={data.messages.filter(
              (m) => m.channel === "facebook" || m.channel === "instagram",
            )}
            title={lead.platform === "instagram" ? "Instagram conversation" : "Messenger conversation"}
            chatLink={lead.chatLink}
            channelTone={lead.platform === "instagram" ? "pink" : "blue"}
            emptyHint="Facebook Messenger and Instagram DM messages will appear here once integrations are connected."
          />
        )}

        {tab === "WhatsApp" && (
          loadedTabs.has("WhatsApp") ? (
            data.whatsappConfigured ? (
              <MessageThread
                messages={data.messages.filter((m) => m.channel === "whatsapp")}
                title="WhatsApp conversation"
                chatLink={lead.chatLink}
                channelTone="green"
                emptyHint="No WhatsApp messages have been ingested for this lead yet."
              />
            ) : (
              <div className="p-5">
                <EmptyState
                  icon="WA"
                  title="WhatsApp is not configured"
                  hint="The CRM ingest path is ready, but WhatsApp credentials are not present in server environment variables."
                />
              </div>
            )
          ) : (
            <div className="p-5 text-[12px] text-ink-400">Loading WhatsApp...</div>
          )
        )}

        {tab === "Comments" && <CommentsPanel comments={data.comments} />}

        {tab === "Notes" && (
          <NotesTab
            leadId={lead.id}
            note={data.lead.note}
            onSaved={(key, value) =>
              setData((current) => ({
                ...current,
                lead: {
                  ...current.lead,
                  note: { ...current.lead.note, [key]: value, updatedAt: new Date().toISOString() },
                },
              }))
            }
          />
        )}

        {tab === "Follow-Up" && (
          <FollowUpPanel
            lead={lead}
            plan={data.followUpPlan}
            pending={pending}
            onSchedule={(workflowType, dueAt, notes) =>
              run(() => scheduleFollowUpAction(lead.id, workflowType, dueAt, notes), () => invalidateTab("Follow-Up"))
            }
            onAddProgram={(workflowType) =>
              run(() => addFollowUpProgramAction(lead.id, workflowType), () => invalidateTab("Follow-Up"))
            }
            onComplete={(followUpId, outcome) =>
              run(() => completeFollowUpAction(lead.id, followUpId, outcome), () => invalidateTab("Follow-Up"))
            }
            onSnooze={(followUpId) =>
              run(() => snoozeFollowUpAction(lead.id, followUpId, 1), () => invalidateTab("Follow-Up"))
            }
            onMarkLost={() => setLostModal(true)}
          />
        )}

        {tab === "Booking" && (
          loadedTabs.has("Booking") ? (
            <BookingTab
              lead={lead}
              bookings={data.bookings}
              catalog={data.bookingCatalog}
              onChanged={(bookings) => {
                const statusById = Object.fromEntries(bookings.map((booking) => [
                  booking.id,
                  booking.status === "unconfirmed" ? "reserved" : booking.status === "completed" ? "attended" : booking.status,
                ]));
                const summary = deriveLeadBookingSummary({ booking_status_by_id: statusById }, bookings[0]?.id);
                setData((current) => ({
                  ...current,
                  bookings,
                  lead: { ...current.lead, bookingStatus: summary.status, bookingContext: summary.context, bookingCount: summary.count },
                }));
                router.refresh();
              }}
            />
          ) : (
            <div className="p-5 text-[12px] text-ink-400">Loading live booking...</div>
          )
        )}

        {tab === "Payments" && (
          loadedTabs.has("Payments") ? (
            <PaymentsTab
              financials={data.financials}
              error={data.financialsError}
              onChanged={() => invalidateTab("Payments")}
            />
          ) : (
            <div className="p-5 text-[12px] text-ink-400">Loading financials...</div>
          )
        )}

        {tab === "Timeline" && (
          <div className="flex flex-col gap-7 p-5">
            {data.escalations.length > 0 && (
              <div>
                <SectionLabel>Escalations & results</SectionLabel>
                <EscalationsPanel escalations={data.escalations} embedded />
              </div>
            )}
            {data.duplicateGroups.length > 0 && (
              <div>
                <SectionLabel>Duplicates</SectionLabel>
                <DuplicatesPanel groups={data.duplicateGroups} leadId={lead.id} embedded />
              </div>
            )}
            <div>
              <SectionLabel>Timeline</SectionLabel>
              <TimelinePanel events={data.timeline} embedded />
            </div>
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
              required={lostReasonIsOther}
              placeholder={lostReasonIsOther ? "Describe the reason" : "Optional details"}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-control border border-line px-3 py-2 text-[12px]" onClick={() => setLostModal(false)}>
              Cancel
            </button>
            <button
              disabled={pending || !lostReasonId || (lostReasonIsOther && !lostNotes.trim())}
              onClick={submitLost}
              className="rounded-control bg-danger px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              Mark Lost
            </button>
          </div>
        </Modal>
      )}
      {confirmStage && (
        <Modal title="Confirm Status Change" onClose={() => setConfirmStage(null)}>
          <div className="space-y-2 text-[12.5px] text-ink-700">
            <div>
              <span className="font-semibold text-ink-500">Patient/lead:</span>{" "}
              {lead.patientName} ({lead.id})
            </div>
            <div>
              <span className="font-semibold text-ink-500">Old status:</span>{" "}
              {STATUS_PILL_LABEL[stage]}
            </div>
            <div>
              <span className="font-semibold text-ink-500">New status:</span>{" "}
              {STATUS_PILL_LABEL[confirmStage]}
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button className="rounded-control border border-line px-3 py-2 text-[12px]" onClick={() => setConfirmStage(null)}>
              Cancel
            </button>
            <button
              disabled={pending}
              onClick={submitStageChange}
              className="rounded-control bg-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
            >
              Confirm change
            </button>
          </div>
        </Modal>
      )}
      {escalateModal && (
        <Modal title="Escalate Lead" onClose={() => setEscalateModal(false)}>
          {data.escalationReasons.length > 0 && (
            <label className="mb-3 block text-[12px] font-semibold text-ink-600">
              Controlled reason
              <select
                value={escalationReasonId}
                onChange={(e) => {
                  const id = e.target.value;
                  setEscalationReasonId(id);
                  const selected = data.escalationReasons.find((r) => r.id === id);
                  if (selected?.severity) setEscalationSeverity(selected.severity);
                }}
                className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
              >
                <option value="">Choose a reason</option>
                {data.escalationReasons.map((r) => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-[12px] font-semibold text-ink-600">
            Details
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
              disabled={pending || escalationReason.trim().length === 0 || (data.escalationReasons.length > 0 && !escalationReasonId)}
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
  if (!lead.platformId) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-[11px] text-ink-400 hover:text-ink-600">Identity & technical</summary>
      <div className="mt-1 divide-y divide-line-faint">
        <DetailRow
          label={lead.platform === "instagram" ? "Instagram ID" : lead.platform === "whatsapp" ? "WhatsApp ID" : "Platform ID"}
          value={<span className="font-mono text-[10.5px] break-all">{lead.platformId}</span>}
        />
      </div>
    </details>
  );
}

function FollowUpPanel({
  lead,
  plan,
  pending,
  onSchedule,
  onAddProgram,
  onComplete,
  onSnooze,
  onMarkLost,
}: {
  lead: Lead;
  plan: FollowUpPlan | null;
  pending: boolean;
  onSchedule: (workflowType: string, dueAt: string, notes?: string) => void;
  onAddProgram: (workflowType: string) => void;
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
  const steps = plan?.steps ?? [];
  const doneCount = steps.filter((step) => step.state === "done").length;
  const currentStep = steps.find((step) => step.state !== "done");

  const dueText = missed
    ? "Overdue"
    : f.nextDate
      ? `Due ${formatDate(f.nextDate)}`
      : "No date set";

  return (
    <div className="flex flex-col gap-4 bg-slate-50/70 p-3 sm:p-5">
      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="text-[13px] font-black text-ink-900">Follow-up programs</div><p className="mt-0.5 text-[11px] text-ink-500">Programs are independent from pipeline status. Existing history is never removed.</p></div>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => onAddProgram("follow_up")} className="rounded-md border border-primary/30 bg-primary-soft px-3 py-2 text-[11.5px] font-bold text-primary disabled:opacity-50">+ Regular template</button>
            <button type="button" disabled={pending} onClick={() => onAddProgram("post_op")} className="rounded-md border border-teal-300 bg-teal-50 px-3 py-2 text-[11.5px] font-bold text-teal-800 disabled:opacity-50">+ Post-op template</button>
          </div>
        </div>
      </section>
      <section className="section-hero overflow-hidden rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Next required action</div>
            <div className="mt-2 text-[22px] font-black text-ink-950">{currentStep?.name ?? f.reason ?? "Schedule the first follow-up"}</div>
            <div className={"mt-1 text-[12px] font-semibold " + (missed || currentStep?.state === "overdue" ? "text-red-600" : "text-ink-500")}>
              {currentStep?.dueAt ? `${currentStep.state === "overdue" ? "Overdue · " : "Due · "}${formatDateTime(currentStep.dueAt)}` : dueText}
            </div>
          </div>
          <div className="section-hero-stat rounded-xl px-4 py-3 text-right">
            <div className="text-[10px] uppercase tracking-wide text-ink-500">Journey progress</div>
            <div className="mt-1 text-[20px] font-black text-ink-950">{doneCount}<span className="text-[12px] text-ink-500"> / {steps.length || "—"}</span></div>
          </div>
        </div>
        {currentStep?.moderatorInstruction && <div className="mt-4 border-s-2 border-primary ps-3 text-[12px] leading-relaxed text-ink-700">{currentStep.moderatorInstruction}</div>}
      </section>
      {plan && plan.steps.length > 0 && (
        <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
          <SectionLabel>{plan.workflowType === "post_op" ? "Post-op follow-up journey" : "Regular lead follow-up journey"}</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {plan.steps.map((step) => (
              <div key={step.id ?? step.sequence} className={"relative rounded-xl border p-3.5 ps-12 " + (step.state === "overdue" ? "border-danger/35 bg-danger-bg/40" : step.state === "done" ? "border-emerald-200 bg-emerald-50/50" : step === currentStep ? "border-primary/35 bg-primary-soft/35" : "border-line bg-white")}>
                <span className={"absolute start-3.5 top-3.5 flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black " + (step.state === "done" ? "bg-success text-white" : step.state === "overdue" ? "bg-danger text-white" : step === currentStep ? "bg-primary text-white" : "bg-line-faint text-ink-500")}>
                  {step.state === "done" ? "✓" : step.sequence}
                </span>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-[13.5px] font-semibold text-ink-900">
                      {step.name || `F/U ${step.sequence}`}
                    </div>
                    <div className="mt-0.5 text-[12px] text-ink-500">
                      Due: {step.dueAt ? formatDate(step.dueAt) : "Not scheduled"}
                    </div>
                  </div>
                  <span
                    className={
                      "rounded-pill px-2.5 py-1 text-[11px] font-semibold capitalize " +
                      (step.state === "overdue"
                        ? "bg-danger-bg text-danger"
                        : step.state === "done"
                          ? "bg-[#ecfdf3] text-success"
                          : step.state === "snoozed"
                            ? "bg-[#fffaeb] text-warn"
                            : "bg-line-faint text-ink-600")
                    }
                  >
                    {step.state}
                  </span>
                </div>
                {step.notes && <div className="mt-2 text-[12.5px] text-ink-700">Notes: {step.notes}</div>}
                {step.moderatorInstruction && (
                  <div className="mt-2 text-[12px] text-ink-500">{step.moderatorInstruction}</div>
                )}
                {(step.completedAt || step.completedBy) && (
                  <div className="mt-2 text-[11.5px] text-ink-400">
                    Completed {step.completedAt ? formatDateTime(step.completedAt) : ""}
                    {step.completedBy ? ` by ${step.completedBy}` : ""}
                  </div>
                )}
                {step === currentStep && <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || step.state === "done"}
                    onClick={() => onComplete(step.id, "Completed")}
                    className="rounded-control border border-success-strong/40 bg-success/5 px-3 py-1.5 text-[12px] font-semibold text-success hover:bg-success/10 disabled:opacity-60"
                  >
                    Mark done
                  </button>
                  <button
                    type="button"
                    disabled={pending || step.state === "done"}
                    onClick={() => onSnooze(step.id)}
                    className="rounded-control border border-line bg-panel px-3 py-1.5 text-[12px] font-semibold text-ink-700 hover:border-primary hover:text-primary disabled:opacity-60"
                  >
                    Snooze 1 day
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={onMarkLost}
                    className="rounded-control border border-danger/30 bg-danger-bg px-3 py-1.5 text-[12px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-60"
                  >
                    Mark lost
                  </button>
                </div>}
              </div>
            ))}
          </div>
        </section>
      )}

      {scheduled && steps.length === 0 ? (
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
      ) : steps.length === 0 ? (
        <EmptyState
          icon="↻"
          title="No follow-up scheduled"
          hint="Schedule a follow-up to keep this lead moving through the pipeline."
        />
      ) : null}

      <details className="group rounded-xl border border-line bg-panel shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3"><div><div className="text-[12.5px] font-black text-ink-900">Schedule a manual follow-up</div><div className="mt-0.5 text-[10.5px] text-ink-400">Use when this patient needs a date outside the configured journey.</div></div><span className="text-[18px] text-ink-400 transition group-open:rotate-45">+</span></summary>
        <div className="border-t border-line p-4">
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
      </details>

      <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
        <SectionLabel>Complete the current action</SectionLabel>
        <p className="mb-3 text-[11px] text-ink-500">Record the outcome before completing so the next moderator understands what happened.</p>
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
      </section>
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
  const conversations = events.filter((event) => event.kind === "message_in" || event.kind === "message_out").length;
  const workflowChanges = events.filter((event) => event.kind === "stage_change" || event.kind === "follow_up" || event.kind === "booking").length;
  return (
    <div className={embedded ? "" : "p-5"}>
      <div className="mb-4 grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-panel text-center">
        <div className="border-r border-line px-2 py-3"><div className="text-[18px] font-black text-ink-900">{events.length}</div><div className="text-[9.5px] font-bold uppercase text-ink-400">All events</div></div>
        <div className="border-r border-line px-2 py-3"><div className="text-[18px] font-black text-primary">{workflowChanges}</div><div className="text-[9.5px] font-bold uppercase text-ink-400">Workflow</div></div>
        <div className="px-2 py-3"><div className="text-[18px] font-black text-emerald-600">{conversations}</div><div className="text-[9.5px] font-bold uppercase text-ink-400">Messages</div></div>
      </div>
      <div className="relative ms-2 border-s-2 border-line-soft ps-6">
        {events.map((e) => (
          <article key={e.id} className="relative pb-4 last:pb-0">
            <span
              className="absolute -start-[31px] top-4 h-3 w-3 rounded-full ring-4 ring-slate-50"
              style={{ backgroundColor: eventDotColor(e) }}
            />
            <div className="rounded-xl border border-line bg-panel px-4 py-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2"><div className="text-[13px] font-black text-ink-900">{eventLabel(e)}</div><div className="text-[10.5px] font-semibold text-ink-400">{formatDateTime(e.at)}</div></div>
              {e.body && <div data-patient-content className="whitespace-pre-wrap text-[12px] text-ink-700">{e.body}</div>}
              {e.actor && <div className="mt-1 text-[10.5px] text-ink-400">By {e.actor}</div>}
            </div>
          </article>
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
            <Link href="/duplicates" className="rounded-control border border-primary bg-primary-soft px-2.5 py-1.5 text-[11.5px] font-semibold text-primary hover:bg-primary-softer">
              Review and merge
            </Link>
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
  action: () => Promise<{ error?: string | null }>;
  label: string;
  pendingLabel: string;
}) {
  const router = useRouter();
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
              const result = await action();
              if (result.error) setError(result.error);
              else router.refresh();
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
        <article key={e.id} className={"overflow-hidden rounded-xl border bg-panel shadow-sm " + (e.status === "resolved" ? "border-emerald-300" : "border-red-300")}>
          <div className={"h-1.5 " + (e.status === "resolved" ? "bg-emerald-500" : e.severity === "critical" ? "bg-red-600" : "bg-amber-500")} />
          <div className="p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge style={SEVERITY_META[e.severity]} />
            <span className="text-[14px] font-black text-ink-900">{e.reason}</span>
            <span
              className={
                "ms-auto rounded-pill px-2 py-0.5 text-[11px] font-semibold capitalize " +
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
          {e.status === "resolved" && (
            <div className="mt-3 border-s-4 border-emerald-500 bg-emerald-50 p-3">
              <div className="text-[10px] font-black uppercase tracking-wide text-emerald-800">Resolution</div>
              <p data-patient-content className="mt-1 whitespace-pre-wrap text-[12.5px] font-medium text-ink-800">{e.resolutionNote || "Resolved without a written result."}</p>
              <div className="mt-1 text-[10.5px] text-ink-500">{e.resolvedBy ? `By ${e.resolvedBy}` : ""}{e.resolvedAt ? ` · ${formatDateTime(e.resolvedAt)}` : ""}</div>
            </div>
          )}
          {e.status !== "resolved" && (
            <div className="mt-2.5 flex justify-end">
              <EscalationResolutionControls
                onReturn={returnEscalationAction.bind(null, e.id)}
                onResolve={resolveEscalationAction.bind(null, e.id)}
              />
            </div>
          )}
          </div>
        </article>
      ))}
    </div>
  );
}
