"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createManualLeadAction } from "@/app/(crm)/leads/actions";
import type { LeadSourceInfo } from "@/lib/types";

export function NewLeadButton({ sources }: { sources: LeadSourceInfo[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      setError(null);
      const result = await createManualLeadAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      if (result.leadId) router.push(`/leads/${result.leadId}`);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-control bg-primary px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-primary-hover"
      >
        + New Lead
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
          <form action={submit} className="w-full max-w-[430px] rounded-card bg-panel p-4 shadow-toast">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-[16px] font-semibold text-clinic-ink">New Lead</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-control border border-line px-2 py-1 text-[12px] text-ink-500"
              >
                x
              </button>
            </div>
            <label className="block text-[12px] font-semibold text-ink-600">
              Patient name
              <input
                name="name"
                required
                className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
              />
            </label>
            <label className="mt-3 block text-[12px] font-semibold text-ink-600">
              Phone
              <input
                name="phone"
                required
                className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
              />
            </label>
            <label className="mt-3 block text-[12px] font-semibold text-ink-600">
              Channel / source
              <select
                name="sourceId"
                className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
              >
                <option value="">Manual entry</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </label>
            <input type="hidden" name="platform" value="manual" />
            <label className="mt-3 block text-[12px] font-semibold text-ink-600">
              Service
              <input
                name="serviceName"
                className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2 text-[12.5px]"
              />
            </label>
            {error && (
              <div className="mt-3 rounded-control bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger">
                {error}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-control border border-line px-3 py-2 text-[12px]"
              >
                Cancel
              </button>
              <button
                disabled={pending}
                className="rounded-control bg-primary px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-60"
              >
                {pending ? "Creating..." : "Create Lead"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
