"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  permanentlyDeleteLeadAction,
  restoreLeadAction,
  type DeleteLeadState,
} from "@/app/(crm)/database/actions";
import type { TrashedLead } from "@/lib/data/leadTrash";
import { formatDateTime } from "@/lib/format";
import { permanentDeleteConfirmation, trashDaysRemaining } from "@/lib/leads/trash";

const IDLE: DeleteLeadState = { ok: false };

function TrashRow({ lead }: { lead: TrashedLead }) {
  const router = useRouter();
  const [restoreState, restoreAction, restoring] = useActionState(restoreLeadAction, IDLE);
  const [deleteState, deleteAction, deleting] = useActionState(permanentlyDeleteLeadAction, IDLE);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const expected = permanentDeleteConfirmation(lead.leadId);
  const days = trashDaysRemaining(lead.purgeAfter);

  useEffect(() => {
    if (restoreState.ok || deleteState.ok) router.refresh();
  }, [deleteState.ok, restoreState.ok, router]);

  return (
    <article className="rounded-xl border border-line-soft bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-black text-primary" data-no-translate>{lead.leadId}</span>
            <strong className="text-[14px] text-ink-900" data-patient-content>{lead.patientName}</strong>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">{days} day{days === 1 ? "" : "s"} remaining</span>
          </div>
          <div className="mt-2 grid gap-x-5 gap-y-1 text-[11.5px] text-ink-500 sm:grid-cols-2">
            <span data-patient-content>{lead.phone}</span>
            <span>Deleted {formatDateTime(lead.deletedAt)}</span>
            <span>By {lead.deletedBy}</span>
            <span>Purge due {formatDateTime(lead.purgeAfter)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={restoreAction}>
            <input type="hidden" name="leadUid" value={lead.id} />
            <button disabled={restoring || deleting} className="rounded-control bg-primary px-3 py-2 text-[11.5px] font-bold text-white disabled:opacity-50">
              {restoring ? "Restoring…" : "Restore complete lead"}
            </button>
          </form>
          <button type="button" disabled={restoring || deleting} onClick={() => setConfirmingDelete((value) => !value)} className="rounded-control border border-red-300 px-3 py-2 text-[11.5px] font-bold text-red-700 disabled:opacity-50">
            Delete permanently
          </button>
        </div>
      </div>
      {restoreState.error && <p className="mt-2 text-[11.5px] font-semibold text-red-600">{restoreState.error}</p>}
      {deleteState.error && <p className="mt-2 text-[11.5px] font-semibold text-red-600">{deleteState.error}</p>}
      {confirmingDelete && (
        <form action={deleteAction} className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <input type="hidden" name="leadUid" value={lead.id} />
          <input type="hidden" name="leadId" value={lead.leadId} />
          <p className="text-[11.5px] leading-5 text-red-800">This bypasses the remaining retention period and permanently removes the lead and its linked CRM records. Type <strong className="font-mono">{expected}</strong>.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="min-w-[260px] flex-1 rounded-control border border-red-300 bg-white px-3 py-2 font-mono text-[12px]" />
            <button disabled={deleting || confirmation !== expected} className="rounded-control bg-red-700 px-3 py-2 text-[11.5px] font-black text-white disabled:opacity-40">
              {deleting ? "Deleting…" : "Confirm permanent deletion"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

export function LeadTrashManager({ leads }: { leads: TrashedLead[] }) {
  return (
    <div className="space-y-4">
      <div className="section-hero rounded-xl p-5">
        <div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Restricted recovery area</div>
        <h3 className="mt-1 text-[22px] font-black text-ink-950">Lead Trash</h3>
        <p className="section-hero-muted mt-1 max-w-3xl text-[12px] leading-5">Only admins and auditors can access this folder. Deleted leads are absent from all operational CRM areas and remain fully recoverable here for 30 days. Expired items are permanently purged.</p>
      </div>
      {leads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-panel p-8 text-center text-[12px] text-ink-500">Trash is empty.</div>
      ) : (
        <div className="space-y-3">{leads.map((lead) => <TrashRow key={lead.id} lead={lead} />)}</div>
      )}
    </div>
  );
}
