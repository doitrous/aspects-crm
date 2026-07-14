"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { STAGE_META, STAGE_ORDER } from "@/lib/badges";
import type { LeadSourceInfo } from "@/lib/types";
import { DateField } from "@/components/ui/DateField";

const PLATFORMS = ["facebook", "instagram", "whatsapp", "web", "referral"];

export function LeadsToolbar({
  sources,
  doctors,
  specialties,
  basePath = "/leads",
  stageLocked = false,
}: {
  sources: LeadSourceInfo[];
  doctors: Array<{ id: string; name: string }>;
  specialties: Array<{ id: string; name: string }>;
  basePath?: string;
  stageLocked?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [query, setQuery] = useState(sp.get("q") ?? "");

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const query = next.toString();
      router.push(query ? `${basePath}?${query}` : basePath);
    },
    [basePath, router, sp],
  );

  const selCls =
    "calm-field h-9 px-2.5 text-[12px] text-ink-700";

  useEffect(() => {
    const current = sp.get("q") ?? "";
    if (query === current) return;
    const timer = window.setTimeout(() => setParam("q", query), 120);
    return () => window.clearTimeout(timer);
  }, [query, setParam, sp]);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-softer bg-toolbar px-[18px] py-2.5">
      <input
        data-lead-search
        type="search"
        value={query}
        placeholder="Search lead ID, MRN, phone or name…"
        onChange={(event) => setQuery(event.target.value)}
        className="calm-field h-11 w-full px-3 text-[12.5px] text-ink-700 placeholder:text-ink-400 sm:h-9 sm:w-[320px]"
      />

      {!stageLocked && (
        <select className={selCls} value={sp.get("stage") ?? ""} onChange={(e) => setParam("stage", e.target.value)}>
          <option value="">Stage: All</option>
          {STAGE_ORDER.map((s) => (
            <option key={s} value={s}>{STAGE_META[s].label}</option>
          ))}
        </select>
      )}

      <select className={selCls} value={sp.get("channel") ?? ""} onChange={(e) => setParam("channel", e.target.value)}>
        <option value="">Channel / Source: All</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={`platform:${p}`} className="capitalize">{p}</option>
        ))}
        {sources.filter((s) => s.active).map((s) => (
          <option key={s.id} value={`source:${s.id}`}>{s.label}</option>
        ))}
      </select>

      <select className={selCls} value={sp.get("doctor") ?? ""} onChange={(e) => setParam("doctor", e.target.value)}>
        <option value="">Doctor: All</option>
        {doctors.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>

      <select className={selCls} value={sp.get("specialty") ?? ""} onChange={(e) => setParam("specialty", e.target.value)}>
        <option value="">Specialty: All</option>
        {specialties.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <DateField key={`from-${sp.get("dateFrom") ?? ""}`} name="dateFrom" defaultValue={sp.get("dateFrom") ?? ""} onChange={(value) => setParam("dateFrom", value)} ariaLabel="Date from" />
      <DateField key={`to-${sp.get("dateTo") ?? ""}`} name="dateTo" defaultValue={sp.get("dateTo") ?? ""} onChange={(value) => setParam("dateTo", value)} ariaLabel="Date to" />

      <div className="ms-auto flex items-center gap-1.5">
        {[
          { k: "unread", label: "Unread" },
          { k: "overdue", label: "Overdue" },
          { k: "escalated", label: "Escalated" },
          { k: "duplicate", label: "Duplicates" },
        ].map((f) => {
          const on = sp.get(f.k) === "1";
          return (
            <button
              key={f.k}
              onClick={() => setParam(f.k, on ? "" : "1")}
              className={
                "h-8 rounded-control border px-2.5 text-[11.5px] font-medium transition-colors " +
                (on
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-line bg-panel text-ink-500 hover:bg-line-faint")
              }
            >
              {f.label}
            </button>
          );
        })}
        {sp.toString() && (
          <button
            onClick={() => router.push(basePath)}
            className="h-8 rounded-control px-2 text-[11.5px] font-medium text-ink-400 hover:text-danger"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
