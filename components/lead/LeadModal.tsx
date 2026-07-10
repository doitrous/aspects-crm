"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LeadDetail, type LeadDetailData } from "@/components/lead/LeadDetail";

/**
 * Slide-over shell for the lead detail, shown over the leads list via the
 * intercepting route. Clicking the darkened backdrop (or pressing Escape)
 * closes the drawer and returns to the list with `router.back()`.
 */
export function LeadModal({ data }: { data: LeadDetailData }) {
  const router = useRouter();

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close lead details"
        onClick={() => router.back()}
        className="absolute inset-0 animate-fadein cursor-default bg-black/40"
      />
      <div className="relative z-10 flex h-full w-full max-w-[920px] animate-drawerin flex-col bg-canvas shadow-toast">
        <div className="flex items-center justify-between border-b border-line bg-toolbar px-5 py-3">
          <div>
            <div className="font-display text-[16px] font-semibold text-ink-900">
              {data.lead.patientName}
            </div>
            <div className="font-mono text-[10.5px] text-ink-400">
              {data.lead.id}
              {data.lead.mrn ? ` · ${data.lead.mrn}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded-control bg-primary px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-primary-hover">
              Reply
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={() => router.back()}
              className="rounded-control border border-line px-2.5 py-2 text-[13px] leading-none text-ink-600 hover:bg-line-faint"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <LeadDetail data={data} />
        </div>
      </div>
    </div>
  );
}
