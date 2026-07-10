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
      {/* Roughly 40% of the viewport. The floor keeps the eight tabs on one row
          on a laptop, where 40vw would be narrower than the drawer used to be;
          the ceiling stops it sprawling on an ultrawide. Below `sm` it is full
          width, because a 40% drawer on a phone is a sliver. */}
      <div className="relative z-10 flex h-full w-full animate-drawerin flex-col overflow-hidden bg-canvas shadow-toast sm:w-[40vw] sm:min-w-[560px] sm:max-w-[1100px]">
        <LeadDetail data={data} onClose={() => router.back()} />
      </div>
    </div>
  );
}
