"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { LeadDetail, type LeadDetailData } from "@/components/lead/LeadDetail";
import { trapTabKey } from "@/lib/accessibility/focusTrap";

/**
 * Slide-over shell for the lead detail, shown over the leads list via the
 * intercepting route. Clicking the darkened backdrop (or pressing Escape)
 * closes the drawer and returns to the list with `router.back()`.
 */
export function LeadModal({ data }: { data: LeadDetailData }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.back();
      trapTabKey(e, dialogRef.current);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus();
    };
  }, [router]);

  return (
    <div className="fixed inset-0 z-[100] flex justify-end">
      <button
        type="button"
        aria-label="Close lead details"
        onClick={() => router.back()}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Lead details for ${data.lead.patientName}`} tabIndex={-1} className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-canvas shadow-toast outline-none sm:w-[94vw] md:w-[88vw] lg:w-[78vw] xl:w-[72vw] xl:max-w-[1380px]">
        <LeadDetail data={data} onClose={() => router.back()} />
      </div>
    </div>
  );
}
