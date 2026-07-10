"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  Booking,
  Comment,
  DuplicateGroup,
  Escalation,
  Lead,
  LeadAttribution,
  Message,
  TimelineEvent,
} from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { CommentsPanel } from "@/components/lead/CommentsPanel";
import { MessageThread } from "@/components/lead/MessageThread";
import { NotesTab } from "@/components/lead/NotesTab";
import {
  BOOKING_META,
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

const TABS = [
  "Conversation",
  "Comments",
  "WhatsApp",
  "Notes",
  "Follow-Up",
  "Booking",
  "Timeline",
  "Duplicates",
  "Escalations / Audit",
] as const;
type Tab = (typeof TABS)[number];

export interface LeadDetailData {
  lead: Lead;
  messages: Message[];
  comments: Comment[];
  attribution: LeadAttribution | null;
  timeline: TimelineEvent[];
  bookings: Booking[];
  escalations: Escalation[];
  duplicateGroups: (DuplicateGroup & { members: { id: string; name: string; phone: string }[] })[];
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-[11.5px] text-ink-400">{label}</span>
      <span className="text-right text-[12px] font-medium text-ink-700">{value}</span>
    </div>
  );
}

export function LeadDetail({ data }: { data: LeadDetailData }) {
  const { lead } = data;
  const [tab, setTab] = useState<Tab>("Conversation");
  const pm = PLATFORM_META[lead.platform];

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left: lead details */}
      <div className="w-[320px] flex-none overflow-auto border-r border-line-soft p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-avatar text-[15px] font-bold text-primary">
            {lead.patientName.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate font-display text-[17px] font-semibold text-clinic-ink">
              {lead.patientName}
            </div>
            <div className="font-mono text-[10.5px] text-ink-400">
              {lead.id}
              {lead.mrn ? ` · ${lead.mrn}` : ""}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge style={STAGE_META[lead.stage]} />
          {lead.escalated && (
            <Badge className="bg-danger-bg text-danger">⚑ Escalated</Badge>
          )}
          {lead.duplicateStatus === "suspected" && (
            <Badge className="bg-[#fffaeb] text-warn">⧉ Duplicate?</Badge>
          )}
        </div>

        <div className="mt-4 divide-y divide-line-faint">
          <DetailRow label="Phone" value={lead.phone} />
          <DetailRow label="Gender" value={<span className="capitalize">{lead.gender ?? "—"}</span>} />
          <DetailRow label="Service" value={lead.serviceName ?? specialtyName(lead.specialtyId)} />
          <DetailRow label="Doctor" value={lead.doctorName ?? doctorName(lead.doctorId)} />
          <DetailRow label="Branch" value={lead.branch ?? "—"} />
          <DetailRow label="Patient type" value={<span className="capitalize">{lead.patientType}</span>} />
          <DetailRow label="Source" value={pm ? pm.label : sourceName(lead.sourceId)} />
          <DetailRow label="Campaign" value={campaignName(lead.campaignId)} />
          <DetailRow label="Coordinator" value={lead.assignedModerator ?? "—"} />
          <DetailRow label="Booking" value={<Badge style={BOOKING_META[lead.bookingStatus]} />} />
          <DetailRow label="Created" value={formatDate(lead.createdAt)} />
        </div>

        {data.attribution && <AttributionSection attribution={data.attribution} />}

        <IdentitySection lead={lead} />

        {lead.tags.length > 0 && (
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] text-ink-400">Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {lead.tags.map((t) => (
                <span key={t} className="rounded-pill bg-line-faint px-2 py-0.5 text-[11px] text-ink-600">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right: tabs */}
      <div className="flex min-w-0 flex-1 flex-col">
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
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {tab === "Conversation" && (
            <MessageThread
              messages={data.messages.filter((m) => m.channel === "facebook" || m.channel === "instagram")}
              emptyHint="Messenger & Instagram DMs will appear here once integrations are connected."
            />
          )}

          {tab === "Comments" && <CommentsPanel comments={data.comments} />}

          {tab === "WhatsApp" && (
            <MessageThread
              messages={data.messages.filter((m) => m.channel === "whatsapp")}
              emptyHint="WhatsApp conversations will appear here once the WhatsApp Business integration is connected."
            />
          )}

          {tab === "Notes" && <NotesTab note={lead.note} />}

          {tab === "Follow-Up" && <FollowUpPanel lead={lead} />}

          {tab === "Booking" && <BookingPanel bookings={data.bookings} />}

          {tab === "Timeline" && <TimelinePanel events={data.timeline} />}

          {tab === "Duplicates" && <DuplicatesPanel groups={data.duplicateGroups} leadId={lead.id} />}

          {tab === "Escalations / Audit" && <EscalationsPanel escalations={data.escalations} />}
        </div>
      </div>
    </div>
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

function FollowUpPanel({ lead }: { lead: Lead }) {
  const f = lead.followUp;
  const missed = f.status === "missed";
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div className="rounded-card border border-line p-4">
        <h3 className="mb-3 font-display text-[15px] font-semibold text-clinic-ink">Current follow-up</h3>
        <div className="divide-y divide-line-faint">
          <DetailRow label="Next follow-up" value={f.nextDate ? formatDate(f.nextDate) : "—"} />
          <DetailRow label="Reason" value={f.reason ?? "—"} />
          <DetailRow
            label="Status"
            value={
              <span className={"font-semibold capitalize " + (missed ? "text-danger" : "text-ink-700")}>
                {f.status}
                {missed ? " (overdue)" : ""}
              </span>
            }
          />
          <DetailRow label="Owner" value={f.owner ?? "—"} />
          <DetailRow label="Last contact" value={f.lastContact ? formatDate(f.lastContact) : "—"} />
          <DetailRow label="Outcome" value={f.outcome ?? "—"} />
        </div>
      </div>
      <div className="rounded-card border border-line p-4">
        <h3 className="mb-3 font-display text-[15px] font-semibold text-clinic-ink">Actions</h3>
        <div className="flex flex-col gap-2">
          {["✓ Mark done", "Schedule next", "Snooze 1 day", "Mark lost"].map((a) => (
            <button
              key={a}
              className="rounded-control border border-line bg-panel px-3 py-2 text-left text-[12.5px] font-medium text-ink-700 hover:border-primary hover:text-primary"
            >
              {a}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BookingPanel({ bookings }: { bookings: Booking[] }) {
  return (
    <div className="p-4">
      <div className="mb-3 rounded-card border border-[#fedf89] bg-[#fffaeb] p-3 text-[12px] text-warn">
        ⚠ Double-booking prevention checks live availability from{" "}
        <span className="font-semibold">adminaspectsclinica.doitrous.com</span> before any slot is confirmed.
        <span className="text-ink-400"> (integration pending — Phase 4)</span>
      </div>
      {bookings.length === 0 ? (
        <EmptyState icon="📅" title="No appointments yet" hint="Book from here once the calendar is connected." />
      ) : (
        <div className="flex flex-col gap-2">
          {bookings.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-card border border-line p-3">
              <div>
                <div className="text-[13px] font-semibold text-ink-900">{formatDateTime(b.startAt)}</div>
                <div className="text-[11.5px] text-ink-400">
                  {doctorName(b.doctorId)} · {b.branch}
                  {b.room ? ` · ${b.room}` : ""} · {b.durationMin}m
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge style={BOOKING_META[b.status]} />
                <span className={"text-[11px] " + (b.calendarSynced ? "text-success" : "text-ink-400")}>
                  {b.calendarSynced ? "✓ synced" : "not synced"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const KIND_ICON: Record<TimelineEvent["kind"], string> = {
  lead_created: "✦",
  message_in: "↙",
  message_out: "↗",
  stage_change: "◆",
  follow_up: "↻",
  booking: "📅",
  note: "✎",
  escalation: "⚑",
  duplicate_merge: "⧉",
  attribution: "🎯",
  audit: "✓",
};

function TimelinePanel({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <EmptyState title="No timeline events" />;
  return (
    <div className="p-4">
      <div className="relative ml-2 border-l border-line pl-5">
        {events.map((e) => (
          <div key={e.id} className="relative pb-4">
            <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full border border-line bg-panel text-[10px]">
              {KIND_ICON[e.kind]}
            </span>
            <div className="text-[12.5px] font-medium text-ink-800">{e.label}</div>
            <div className="text-[10.5px] text-ink-400">
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
}: {
  groups: LeadDetailData["duplicateGroups"];
  leadId: string;
}) {
  if (groups.length === 0)
    return <EmptyState icon="⧉" title="No suspected duplicates" hint="This lead has no matching records." />;
  return (
    <div className="flex flex-col gap-3 p-4">
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
            {["Merge leads", "Link without merge", "Mark not duplicate", "Dismiss"].map((a) => (
              <button
                key={a}
                className="rounded-control border border-line bg-panel px-2.5 py-1.5 text-[11.5px] font-medium text-ink-600 hover:border-primary hover:text-primary"
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EscalationsPanel({ escalations }: { escalations: Escalation[] }) {
  if (escalations.length === 0)
    return <EmptyState icon="⚑" title="No escalations" hint="Raise an escalation if this lead needs auditor attention." />;
  return (
    <div className="flex flex-col gap-3 p-4">
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
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <input
                placeholder="Resolution note…"
                className="h-8 flex-1 rounded-control border border-line px-2.5 text-[12px]"
              />
              <button className="rounded-control bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-hover">
                Resolve
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
