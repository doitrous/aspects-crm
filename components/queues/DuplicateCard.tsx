"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DuplicatePair, LeadSummary } from "@/lib/types";
import { Badge } from "@/components/ui/Badge";
import { STAGE_META, PLATFORM_META } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import { ResolveButton } from "@/components/queues/ResolveButton";
import { resolveDuplicateAction } from "@/app/(crm)/duplicates/actions";

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
          <dt className="text-ink-400">Phone</dt>
          <dd className="font-medium text-ink-700">{lead.phone || "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Source</dt>
          <dd className="font-medium text-ink-700">{pm ? pm.label : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-ink-400">Service</dt>
          <dd className="font-medium text-ink-700">{lead.serviceName ?? "—"}</dd>
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
  merged: { label: "Merged", bg: "#ecfdf3", fg: "#067647" },
  not_duplicate: { label: "Not a duplicate", bg: "#f2f4f7", fg: "#667085" },
};

const STAGE_LABEL = {
  new: "New Lead",
  qualified: "Qualified",
  booked: "Booked",
  follow_up: "Follow-Up",
  post_op: "Post-Op Follow-Up",
  lost: "Lost",
} as const;

export function DuplicateCard({ pair }: { pair: DuplicatePair }) {
  const router = useRouter();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [keepStatus, setKeepStatus] = useState(pair.primary?.stage ?? "new");
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergePending, startMerge] = useTransition();
  const resolved = pair.status === "merged" || pair.status === "not_duplicate";
  const rm = RESOLVED_META[pair.status];
  const conflictingStages = pair.primary && pair.duplicate && pair.primary.stage !== pair.duplicate.stage;

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

  return (
    <div className="rounded-card border border-line bg-panel p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-[#fffaeb] px-2.5 py-1 text-[11px] font-semibold text-warn">
          ⧉ {Math.round(pair.confidence * 100)}% match
        </span>
        <span className="rounded-pill bg-line-faint px-2.5 py-1 text-[11px] font-medium text-ink-600">
          on {pair.type}
        </span>
        {pair.notes && (
          <span className="text-[11.5px] text-ink-400">{pair.notes}</span>
        )}
        {resolved && rm && (
          <span
            className="ml-auto rounded-pill px-2.5 py-1 text-[11px] font-semibold"
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
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-line-faint pt-3">
          <ResolveButton
            action={resolveDuplicateAction.bind(null, pair.id, "dismissed")}
            label="Not a duplicate"
            pendingLabel="Saving…"
            tone="ghost"
          />
          <button type="button" onClick={() => conflictingStages ? setMergeOpen(true) : merge()} className="rounded-control bg-primary px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-primary-hover">
            Merge duplicate
          </button>
        </div>
      )}
      {mergeOpen && pair.primary && pair.duplicate && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Choose merged lead status">
          <div className="w-full max-w-md rounded-card border border-line bg-panel p-5 shadow-xl">
            <h3 className="text-[16px] font-bold text-ink-900">Which status should the merged lead keep?</h3>
            <p className="mt-1 text-[12px] text-ink-500">These records have different primary stages. The selected status determines where the surviving lead appears.</p>
            <div className="mt-4 grid gap-2">
              {[pair.primary.stage, pair.duplicate.stage].map((status) => (
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
