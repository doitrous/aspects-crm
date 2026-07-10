"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { doctors, specialties, sources } from "@/lib/data/reference";
import { STAGE_META, STAGE_ORDER } from "@/lib/badges";

const PLATFORMS = ["facebook", "instagram", "whatsapp", "web", "referral"];

export function LeadsToolbar() {
  const router = useRouter();
  const sp = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(sp.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      router.push(`/leads?${next.toString()}`);
    },
    [router, sp],
  );

  const selCls =
    "h-8 rounded-control border border-line bg-panel px-2 text-[12px] text-ink-600 focus:border-primary";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line-softer bg-toolbar px-[18px] py-2.5">
      <input
        defaultValue={sp.get("q") ?? ""}
        placeholder="⌕  Lead ID, MRN, phone, name, chat link…"
        onKeyDown={(e) => {
          if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value);
        }}
        className="h-8 w-[280px] rounded-control border border-line bg-panel px-3 text-[12.5px] text-ink-700 placeholder:text-ink-400"
      />

      <select className={selCls} value={sp.get("stage") ?? ""} onChange={(e) => setParam("stage", e.target.value)}>
        <option value="">Stage: All</option>
        {STAGE_ORDER.map((s) => (
          <option key={s} value={s}>{STAGE_META[s].label}</option>
        ))}
      </select>

      <select className={selCls} value={sp.get("platform") ?? ""} onChange={(e) => setParam("platform", e.target.value)}>
        <option value="">Platform: All</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p} className="capitalize">{p}</option>
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

      <select className={selCls} value={sp.get("source") ?? ""} onChange={(e) => setParam("source", e.target.value)}>
        <option value="">Source: All</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <div className="ml-auto flex items-center gap-1.5">
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
            onClick={() => router.push("/leads")}
            className="h-8 rounded-control px-2 text-[11.5px] font-medium text-ink-400 hover:text-danger"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
