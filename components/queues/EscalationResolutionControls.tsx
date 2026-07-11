"use client";

import Link from "next/link";
import { useState } from "react";
import type { EscalationActionState } from "@/app/(crm)/escalations/actions";

export function EscalationResolutionControls({
  onReturn,
  onResolve,
}: {
  onReturn: (note?: string) => Promise<EscalationActionState>;
  onResolve: (note?: string) => Promise<EscalationActionState>;
}) {
  const [note, setNote] = useState("");
  const [pendingAction, setPendingAction] = useState<"return" | "resolve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<EscalationActionState | null>(null);

  async function run(kind: "return" | "resolve", action: (note?: string) => Promise<EscalationActionState>) {
    setPendingAction(kind);
    setError(null);
    setSuccess(null);
    try {
      const result = await action(note.trim() || undefined);
      if (result.error) setError(result.error);
      else setSuccess(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setPendingAction(null);
    }
  }

  if (success?.ok) {
    return (
      <div className="min-w-[220px] rounded-control border border-emerald-200 bg-emerald-50 px-3 py-2 text-left">
        <div className="text-[11.5px] font-semibold text-emerald-800">{success.ok}</div>
        {success.href && <Link href={success.href} className="mt-1 block text-[11px] font-semibold text-primary hover:underline">Open moderator message →</Link>}
      </div>
    );
  }

  return (
    <div className="flex min-w-[220px] flex-col items-stretch gap-1.5">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Resolution note"
        className="h-8 rounded-control border border-line bg-panel px-2.5 text-[12px] text-ink-700"
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void run("return", onReturn)}
          className="rounded-control border border-line px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-600 hover:bg-line-faint disabled:opacity-60"
        >
          {pendingAction === "return" ? "Sending..." : "Send back"}
        </button>
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => void run("resolve", onResolve)}
          className="rounded-control bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pendingAction === "resolve" ? "Resolving..." : "Completely resolved"}
        </button>
      </div>
      {error && <span className="text-right text-[10px] text-danger">{error}</span>}
    </div>
  );
}
