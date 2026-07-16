"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DuplicatePair, LeadSummary } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { STAGE_META, PLATFORM_META } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { relatedDuplicateAction, resolveDuplicateAction, samePatientDuplicateAction } from "@/app/(crm)/duplicates/actions";
import type { LeadRelationship } from "@/lib/types";

function Side({ lead, tag }: { lead?: LeadSummary; tag: string }) {
  if (!lead) {
    return (
      <div className="flex-1 rounded-control border border-line-soft bg-line-faint/40 p-3 text-[12px] text-ink-400">
        {tag}: lead not found
      </div>
    );
  }
  const pm = PLATFORM_META[lead.platform];
  return (
    <Link
      href={`/leads/${lead.id}`}
      className="group flex-1 rounded-control border border-line-soft bg-panel p-3 transition-colors hover:border-primary/40"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-400">
          {tag}
        </span>
        <Badge style={STAGE_META[lead.stage]} />
      </div>
      <div className="font-semibold text-ink-900 group-hover:text-primary">{lead.name}</div>
      <div className="font-mono text-[10.5px] text-ink-400">{lead.id}</div>
      <dl className="mt-2 space-y-1 text-[11.5px]">
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">MRN</dt>
          <dd className="font-mono font-medium text-ink-700">{lead.mrn || "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Phone</dt>
          <dd className="font-medium text-ink-700">{lead.phone || "—"}</dd>
        </div>
        {lead.platformId && (
          <div className="flex justify-between gap-2">
            <dt className="text-ink-400">Platform ID</dt>
            <dd className="max-w-[180px] truncate font-mono font-medium text-ink-700">{lead.platformId}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Source</dt>
          <dd className="font-medium text-ink-700">{pm ? pm.label : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Service</dt>
          <dd className="text-right font-medium text-ink-700">{lead.serviceNames?.join(", ") ?? lead.serviceName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Doctors</dt>
          <dd className="text-right font-medium text-ink-700">{lead.doctorNames?.join(", ") ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Coordinator</dt>
          <dd className="font-medium text-ink-700">{lead.assignedModerator ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Created</dt>
          <dd className="font-medium text-ink-700">{formatDate(lead.createdAt)}</dd>
        </div>
      </dl>
    </Link>
  );
}

const RESOLVED_META: Record<string, { label: string; bg: string; fg: string }> = {
  linked: { label: "Linked", bg: "#eef4ff", fg: "#3538cd" },
  merged: { label: "Merged", bg: "#ecfdf3", fg: "#067647" },
  not_duplicate: { label: "Not a duplicate", bg: "#f2f4f7", fg: "#667085" },
};

const MATCH_LABEL: Record<string, string> = {
  mrn: "MRN",
  lead_id: "Lead ID",
  phone: "Phone number",
  platform_id: "Platform ID",
  unique_id: "Unique ID",
  chat_link: "Chat link",
  name: "Three-part name",
};

const STAGE_LABEL = {
  new: "New Lead",
  qualified: "Qualified",
  booked: "Booked",
  follow_up: "Follow-Up",
  post_op: "Post-Op Follow-Up",
  lost: "Lost",
} as const;

export function DuplicateCard({
  pair,
  selectable = false,
  selected = false,
  onSelectedChange,
}: {
  pair: DuplicatePair;
  selectable?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const router = useRouter();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [keepStatus, setKeepStatus] = useState(pair.primary?.stage ?? "new");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergePending, startMerge] = useTransition();
  const [decisionOpen, setDecisionOpen] = useState<"same" | "family" | "contact" | null>(null);
  const [relationship, setRelationship] = useState<LeadRelationship>("parent");
  const [decisionNote, setDecisionNote] = useState("");
  const [canonicalLeadId, setCanonicalLeadId] = useState(pair.primary?.id ?? pair.duplicate?.id ?? "");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [decisionPending, startDecision] = useTransition();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resolved = pair.status === "linked" || pair.status === "merged" || pair.status === "not_duplicate";
  const rm = RESOLVED_META[pair.status];

  useEffect(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    if (dialog) dialog.querySelector<HTMLElement>("button, input, select, textarea, a[href]")?.focus();
    if (!decisionOpen && !mergeOpen) returnFocusRef.current?.focus();
  }, [decisionOpen, mergeOpen]);

  function rememberFocus() {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  function merge() {
    startMerge(async () => {
      setMergeError(null);
      const result = await resolveDuplicateAction(pair.id, "merged", undefined, keepStatus);
      if (result.error) {
        setMergeError(result.error);
        return;
      }
      setMergeOpen(false);
      router.refresh();
    });
  }

  function decideRelationship() {
    if (!decisionOpen) return;
    startDecision(async () => {
      setDecisionError(null);
      const result = decisionOpen === "same"
        ? await samePatientDuplicateAction(pair.id, canonicalLeadId, decisionNote)
        : await relatedDuplicateAction(pair.id, relationship, decisionNote);
      if (result.error) { setDecisionError(result.error); return; }
      setDecisionOpen(null); setDecisionNote(""); router.refresh();
    });
  }

  function dismissSuggestion(differentPeople: boolean) {
    const note = window.prompt("Optional moderator note", differentPeople ? "Reviewed as different people" : "");
    if (note === null) return;
    startDecision(async () => {
      setDecisionError(null);
      const result = await resolveDuplicateAction(pair.id, "dismissed", note.trim() || (differentPeople ? "Reviewed as different people" : undefined));
      if (result.error) { setDecisionError(result.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="rounded-card border border-line bg-panel p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {selectable && (
          <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-control border border-line px-2.5 text-[11px] font-semibold text-ink-700">
            <input type="checkbox" checked={selected} onChange={(event) => onSelectedChange?.(event.target.checked)} />
            Select
          </label>
        )}
        <span className="rounded-pill bg-[#fffaeb] px-2.5 py-1 text-[11px] font-semibold text-warn">
          ⧉ {Math.round(pair.confidence * 100)}% match
        </span>
        <span className="rounded-pill bg-line-faint px-2.5 py-1 text-[11px] font-medium text-ink-600">
          on {MATCH_LABEL[pair.type] ?? pair.type}
        </span>
        {pair.notes && (
          <span className="text-[11.5px] text-ink-400">{pair.notes}</span>
        )}
        {resolved && rm && (
          <span
            className="ms-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: rm.bg, color: rm.fg }}
          >
            {rm.label}
            {pair.reviewedBy ? ` · ${pair.reviewedBy}` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <Side lead={pair.primary} tag="Primary" />
        <div className="flex items-center justify-center text-ink-300">
          <span className="text-[18px]">⇄</span>
        </div>
        <Side lead={pair.duplicate} tag="Suspected duplicate" />
      </div>

      {!resolved && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line-faint pt-3">
          <button type="button" disabled={decisionPending} onClick={() => dismissSuggestion(false)} className="rounded-control border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink-700 disabled:opacity-50">Dismiss suggestion</button>
          <button type="button" disabled={decisionPending} onClick={() => dismissSuggestion(true)} className="rounded-control border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink-700 disabled:opacity-50">Different people</button>
          <button type="button" onClick={() => { rememberFocus(); setDecisionOpen("contact"); setRelationship("guardian"); }} className="rounded-control border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink-700">Guardian / caregiver</button>
          <button type="button" onClick={() => { rememberFocus(); setDecisionOpen("family"); setRelationship("parent"); }} className="rounded-control border border-line px-3 py-1.5 text-[11.5px] font-semibold text-ink-700">Family members</button>
          <button type="button" onClick={() => { rememberFocus(); setDecisionOpen("same"); }} className="rounded-control border border-primary bg-primary-soft px-3 py-1.5 text-[11.5px] font-semibold text-primary">Same patient</button>
          <button type="button" onClick={() => { rememberFocus(); setMergeOpen(true); }} className="rounded-control bg-primary px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-primary-hover">
            Merge records
          </button>
        </div>
      )}
      {decisionOpen && pair.primary && pair.duplicate && <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label="Record duplicate decision"><div className="w-full max-w-lg rounded-card border border-line bg-panel p-5 shadow-xl"><h3 className="text-[16px] font-black text-ink-900">{decisionOpen === "same" ? "Link as the same patient" : decisionOpen === "family" ? "Record family relationship" : "Record guardian, caregiver or related contact"}</h3><p className="mt-1 text-[11.5px] text-ink-500">Both original leads remain openable. No messages, appointments, payments, notes or history are deleted.</p>{decisionOpen === "same" ? <fieldset className="mt-4 grid gap-2"><legend className="mb-1 text-[11px] font-bold text-ink-600">Canonical patient record</legend>{[pair.primary, pair.duplicate].map((lead) => <label key={lead.id} className={`rounded-control border p-3 text-[12px] ${canonicalLeadId === lead.id ? "border-primary bg-primary-soft" : "border-line"}`}><input className="me-2" type="radio" checked={canonicalLeadId === lead.id} onChange={() => setCanonicalLeadId(lead.id)}/><b>{lead.id}</b> · {lead.name} · MRN {lead.mrn || "missing"}</label>)}</fieldset> : <label className="mt-4 block text-[11px] font-bold text-ink-600">Relationship type<select value={relationship} onChange={(event) => setRelationship(event.target.value as LeadRelationship)} className="mt-1 h-10 w-full rounded-control border border-line bg-panel px-3 text-[12px]">{(decisionOpen === "family" ? [["parent","Parent"],["child","Child"],["spouse","Spouse"],["sibling","Sibling"],["relative","Relative"],["same_household","Same household"],["other","Other"]] : [["guardian","Guardian"],["caregiver","Caregiver"],["related_contact","Related contact"],["other","Other"]]).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}<label className="mt-3 block text-[11px] font-bold text-ink-600">Optional moderator note<textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} rows={2} className="mt-1 w-full rounded-control border border-line p-2 text-[12px]"/></label>{decisionError && <p role="alert" className="mt-2 text-[11px] font-semibold text-danger">{decisionError}</p>}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setDecisionOpen(null)} className="rounded-control border border-line px-3 py-2 text-[12px]">Cancel</button><button type="button" disabled={decisionPending} onClick={decideRelationship} className="rounded-control bg-primary px-3 py-2 text-[12px] font-bold text-white">{decisionPending ? "Saving…" : "Confirm decision"}</button></div></div></div>}
      {mergeOpen && pair.primary && pair.duplicate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Choose merged lead status">
          <div className="w-full max-w-md rounded-card border border-line bg-panel p-5 shadow-xl">
            <h3 className="text-[16px] font-bold text-ink-900">Which status should the merged lead keep?</h3>
            <p className="mt-1 text-[12px] text-ink-500">Confirm the status the surviving lead will keep. All linked history is retained and this merge cannot be undone automatically.</p>
            <div className="mt-4 grid gap-2">
              {[...new Set([pair.primary.stage, pair.duplicate.stage])].map((status) => (
                <label key={status} className={`flex cursor-pointer items-center gap-3 rounded-control border p-3 text-[12.5px] font-semibold ${keepStatus === status ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-700"}`}>
                  <input type="radio" checked={keepStatus === status} onChange={() => setKeepStatus(status)} />
                  {STAGE_LABEL[status]}
                </label>
              ))}
            </div>
            {mergeError && <div className="mt-3 rounded-control bg-danger-bg p-2 text-[12px] font-medium text-danger">{mergeError}</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={mergePending} onClick={() => setMergeOpen(false)} className="rounded-control border border-line px-3 py-2 text-[12px] font-semibold text-ink-600">Cancel</button>
              <button type="button" disabled={mergePending} onClick={merge} className="rounded-control bg-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60">{mergePending ? "Merging…" : "Merge and keep status"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
