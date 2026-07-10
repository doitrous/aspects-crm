import Link from "next/link";
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

export function DuplicateCard({ pair }: { pair: DuplicatePair }) {
  const resolved = pair.status === "merged" || pair.status === "not_duplicate";
  const rm = RESOLVED_META[pair.status];

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
          <ResolveButton
            action={resolveDuplicateAction.bind(null, pair.id, "merged")}
            label="Merge duplicate"
            pendingLabel="Merging…"
          />
        </div>
      )}
    </div>
  );
}
