"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DuplicatePair, DuplicateQueueView } from "@/lib/types";
import { DuplicateCard } from "@/components/queues/DuplicateCard";
import { bulkResolveDuplicatesAction } from "@/app/(crm)/duplicates/actions";

export function DuplicateReviewList({ items, view }: { items: DuplicatePair[]; view: DuplicateQueueView }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, startTransition] = useTransition();
  const openItems = view === "open" ? items : [];
  const allSelected = openItems.length > 0 && openItems.every((pair) => selected.has(pair.id));

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function run(decision: "merged" | "linked") {
    const chosen = openItems.filter((pair) => selected.has(pair.id));
    if (!chosen.length) return;
    if (decision === "merged") {
      if (!window.confirm(`Merge ${chosen.length} selected duplicate pair${chosen.length === 1 ? "" : "s"}? The duplicate records will be consolidated into each Primary record.`)) return;
      if (!window.confirm("Final warning: merging moves related history and cannot be automatically undone. Continue?")) return;
    } else if (!window.confirm(`Link ${chosen.length} selected pair${chosen.length === 1 ? "" : "s"} without combining their records?`)) {
      return;
    }
    startTransition(async () => {
      setMessage({});
      const result = await bulkResolveDuplicatesAction(
        chosen.map((pair) => ({ flagId: pair.id, keepStatus: pair.primary?.stage })),
        decision,
      );
      setMessage({ ok: result.ok ?? undefined, error: result.error ?? undefined });
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {view === "open" && items.length > 0 && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-card border border-primary/20 bg-panel p-3 shadow-sm">
          <label className="me-auto inline-flex min-h-9 cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink-700">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(event) => setSelected(event.target.checked ? new Set(openItems.map((pair) => pair.id)) : new Set())}
            />
            Select all {openItems.length} on this page
          </label>
          <span className="text-[11.5px] font-semibold text-ink-500">{selected.size} selected</span>
          <button type="button" disabled={pending || selected.size === 0} onClick={() => run("linked")} className="min-h-9 rounded-control border border-primary/30 bg-primary-soft px-3 text-[12px] font-bold text-primary disabled:opacity-40">
            {pending ? "Processing…" : "Bulk-Link"}
          </button>
          <button type="button" disabled={pending || selected.size === 0} onClick={() => run("merged")} className="min-h-9 rounded-control bg-primary px-3 text-[12px] font-bold text-white disabled:opacity-40">
            {pending ? "Processing…" : "Bulk-Merge"}
          </button>
        </div>
      )}
      {message.ok && <div role="status" className="rounded-control border border-emerald-200 bg-emerald-50 p-3 text-[12px] font-semibold text-emerald-700">{message.ok}</div>}
      {message.error && <div role="alert" className="rounded-control border border-red-200 bg-red-50 p-3 text-[12px] font-semibold text-red-700">{message.error}</div>}
      {items.map((pair) => (
        <DuplicateCard
          key={pair.id}
          pair={pair}
          selectable={view === "open"}
          selected={selected.has(pair.id)}
          onSelectedChange={(checked) => toggle(pair.id, checked)}
        />
      ))}
    </div>
  );
}
