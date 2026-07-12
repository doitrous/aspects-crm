"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteWebsiteReservationAction,
  dismissWebsiteReservationAction,
  type ReservationManagementState,
} from "@/app/(crm)/reservations/actions";

const IDLE: ReservationManagementState = { ok: false };

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center p-4"><button type="button" aria-label="Close reservation confirmation" onClick={onClose} className="absolute inset-0 bg-black/60"/><div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-lg rounded-2xl border border-line bg-panel p-5 shadow-2xl">{children}</div></div>;
}

export function ReservationManagementControls({ appointmentId, patientName }: { appointmentId: string; patientName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"dismiss" | "delete" | null>(null);
  const [step, setStep] = useState(0);
  const [confirmation, setConfirmation] = useState("");
  const [dismissState, dismissAction, dismissPending] = useActionState(dismissWebsiteReservationAction, IDLE);
  const [deleteState, deleteAction, deletePending] = useActionState(deleteWebsiteReservationAction, IDLE);
  const state = mode === "delete" ? deleteState : dismissState;

  useEffect(() => {
    if (dismissState.ok || deleteState.ok) {
      setMode(null);
      setStep(0);
      setConfirmation("");
      router.refresh();
    }
  }, [dismissState.ok, deleteState.ok, router]);

  function open(nextMode: "dismiss" | "delete") {
    setMode(nextMode);
    setStep(1);
    setConfirmation("");
  }

  return <div onClick={(event) => event.stopPropagation()} className="flex items-center gap-1.5">
    <button type="button" onClick={() => open("dismiss")} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10.5px] font-bold text-amber-800 hover:bg-amber-100">Dismiss</button>
    <button type="button" onClick={() => open("delete")} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10.5px] font-bold text-red-700 hover:bg-red-100">Delete</button>
    {mode && step > 0 && <Dialog onClose={() => setMode(null)}>
      {step === 1 ? <>
        <div className={`text-[10px] font-black uppercase tracking-[.16em] ${mode === "delete" ? "text-red-600" : "text-amber-700"}`}>Confirmation 1 of 2</div>
        <h2 className="mt-2 text-xl font-black text-ink-900">{mode === "delete" ? "Permanently delete this reservation?" : "Dismiss this reservation?"}</h2>
        <p className="mt-2 text-sm text-ink-600"><strong>{patientName}</strong>{mode === "delete" ? " will be removed from the booking website. The patient’s CRM lead stays in Database." : " will be hidden from the Website Reservations queue. The booking and patient lead remain available elsewhere."}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setMode(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink-600">Cancel</button><button type="button" onClick={() => setStep(2)} className={`rounded-xl px-4 py-2 text-sm font-black text-white ${mode === "delete" ? "bg-red-600" : "bg-amber-600"}`}>I understand — continue</button></div>
      </> : <>
        <div className={`text-[10px] font-black uppercase tracking-[.16em] ${mode === "delete" ? "text-red-600" : "text-amber-700"}`}>Confirmation 2 of 2 · Final confirmation</div>
        <h2 className={`mt-2 text-xl font-black ${mode === "delete" ? "text-red-700" : "text-ink-900"}`}>{mode === "delete" ? "This reservation cannot be recovered" : "Hide this reservation from the queue"}</h2>
        {mode === "delete" ? <form action={deleteAction} className="mt-3"><input type="hidden" name="appointmentId" value={appointmentId}/><input type="hidden" name="warningOne" value="acknowledged"/><input type="hidden" name="warningTwo" value="acknowledged"/><p className="text-sm text-ink-600">Type <strong className="font-mono text-red-700">DELETE RESERVATION</strong> exactly.</p><input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" className="mt-3 w-full rounded-xl border border-red-300 bg-red-50 px-3 py-3 font-mono text-sm font-bold text-red-800" placeholder="DELETE RESERVATION"/>{state.error && <p className="mt-2 text-xs font-bold text-red-600">{state.error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setMode(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink-600">Cancel</button><button disabled={deletePending || confirmation !== "DELETE RESERVATION"} className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40">{deletePending ? "Deleting…" : "Permanently delete"}</button></div></form> : <form action={dismissAction} className="mt-3"><input type="hidden" name="appointmentId" value={appointmentId}/><input type="hidden" name="warningOne" value="acknowledged"/><input type="hidden" name="warningTwo" value="acknowledged"/><p className="text-sm text-ink-600">This is the second confirmation. You can still cancel without changing anything.</p>{state.error && <p className="mt-2 text-xs font-bold text-red-600">{state.error}</p>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setMode(null)} className="rounded-xl border border-line px-4 py-2 text-sm font-bold text-ink-600">Cancel</button><button disabled={dismissPending} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-black text-white disabled:opacity-40">{dismissPending ? "Dismissing…" : "Confirm dismissal"}</button></div></form>}
      </>}
    </Dialog>}
  </div>;
}
