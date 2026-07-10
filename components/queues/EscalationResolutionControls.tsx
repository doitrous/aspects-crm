"use client";

import { useState, useTransition } from "react";

export function EscalationResolutionControls({
  onReturn,
  onResolve,
}: {
  onReturn: (note?: string) => Promise<void>;
  onResolve: (note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: (note?: string) => Promise<void>) {
    startTransition(async () => {
      setError(null);
      try {
        await action(note.trim() || undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      }
    });
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
          disabled={pending}
          onClick={() => run(onReturn)}
          className="rounded-control border border-line px-2.5 py-1.5 text-[11.5px] font-semibold text-ink-600 hover:bg-line-faint disabled:opacity-60"
        >
          {pending ? "Working..." : "Send back"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(onResolve)}
          className="rounded-control bg-primary px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Working..." : "Completely resolved"}
        </button>
      </div>
      {error && <span className="text-right text-[10px] text-danger">{error}</span>}
    </div>
  );
}
