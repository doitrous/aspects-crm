"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteLeadAction, type DeleteLeadState } from "@/app/(crm)/database/actions";
import { trashConfirmation } from "@/lib/leads/trash";

const IDLE: DeleteLeadState = { ok: false };

export function DeleteLeadButton({ leadId, patientName }: { leadId: string; patientName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [state, action, pending] = useActionState(deleteLeadAction, IDLE);
  const expected = trashConfirmation(leadId);

  useEffect(() => {
    if (!state.ok) return;
    setOpen(false);
    setConfirmation("");
    router.replace("/leads");
    router.refresh();
  }, [router, state.ok]);

  return (
    <section className="rounded-xl border border-red-200 bg-red-50/70 p-4" onClick={(event) => event.stopPropagation()}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-black text-red-800">Delete lead</div>
          <p className="mt-1 max-w-2xl text-[11.5px] leading-5 text-red-700">
            Remove {patientName} from every CRM list, search, report, conversation, and workflow. The complete record remains recoverable in Settings → Trash for 30 days, then it is permanently purged.
          </p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="rounded-control border border-red-300 bg-white px-3 py-2 text-[11.5px] font-black text-red-700 hover:bg-red-100">
          Move to Trash
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button type="button" aria-label="Close delete confirmation" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60" />
          <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-lg rounded-2xl border border-red-200 bg-panel p-5 shadow-2xl">
            <div className="text-[10px] font-black uppercase tracking-[.16em] text-red-600">30-day recoverable deletion</div>
            <h2 className="mt-2 text-xl font-black text-ink-900">Move {leadId} to Trash?</h2>
            <p className="mt-2 text-sm leading-6 text-ink-600">
              The lead immediately disappears from active CRM areas. Admins and auditors can restore the complete record from Settings → Trash during the next 30 days.
            </p>
            <form action={action} className="mt-4">
              <input type="hidden" name="leadId" value={leadId} />
              <label className="text-[12px] font-semibold text-ink-700">
                Type <strong className="font-mono text-red-700">{expected}</strong>
                <input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-2 w-full rounded-xl border border-red-300 bg-red-50 px-3 py-3 font-mono text-sm font-bold text-red-800" />
              </label>
              {state.error && <p className="mt-2 text-xs font-bold text-red-600">{state.error}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink-600">Cancel</button>
                <button disabled={pending || confirmation !== expected} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">
                  {pending ? "Moving…" : "Move to Trash"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
