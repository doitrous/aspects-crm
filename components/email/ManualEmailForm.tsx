"use client";

import { useActionState } from "react";
import { sendManualEmailAction, type ManualEmailState } from "@/app/(crm)/emails/actions";

export function ManualEmailForm() {
  const [state, action, pending] = useActionState<ManualEmailState, FormData>(sendManualEmailAction, {});
  const field = "w-full rounded-control border border-line bg-panel px-3 py-2 text-[12.5px] outline-none focus:border-primary";
  return (
    <form action={action} className="mb-4 border-b border-line-soft bg-panel p-4">
      <div className="mb-3">
        <h2 className="text-[14px] font-bold text-ink-900">Send Email</h2>
        <p className="text-[11.5px] text-ink-500">Send a custom email. The real provider result is recorded in the log below.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="text-[11.5px] font-semibold text-ink-600">Recipients
          <input name="recipients" required placeholder="patient@example.com, second@example.com" className={`mt-1 ${field}`} />
        </label>
        <label className="text-[11.5px] font-semibold text-ink-600">Subject
          <input name="subject" required className={`mt-1 ${field}`} />
        </label>
      </div>
      <label className="mt-3 block text-[11.5px] font-semibold text-ink-600">Message
        <textarea name="body" required rows={7} className={`mt-1 resize-y ${field}`} />
      </label>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className={state.error ? "text-[11.5px] font-semibold text-danger" : "text-[11.5px] font-semibold text-success"}>{state.error ?? state.ok}</span>
        <button disabled={pending} className="rounded-control bg-primary px-4 py-2 text-[12px] font-semibold text-white disabled:opacity-60">{pending ? "Sending..." : "Send Email"}</button>
      </div>
    </form>
  );
}
