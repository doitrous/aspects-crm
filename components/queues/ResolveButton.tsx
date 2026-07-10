"use client";

import { useState, useTransition } from "react";

/**
 * Small async action button used across the auditor queues. Shows a pending
 * state, prevents double-submits, and surfaces failures inline.
 */
export function ResolveButton({
  action,
  label,
  pendingLabel = "Working…",
  tone = "primary",
}: {
  action: () => Promise<void>;
  label: string;
  pendingLabel?: string;
  tone?: "primary" | "ghost";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const base =
    "rounded-control px-3 py-1.5 text-[11.5px] font-semibold transition-colors disabled:opacity-60";
  const styles =
    tone === "primary"
      ? "bg-primary text-white hover:bg-primary-hover"
      : "border border-line text-ink-600 hover:bg-line-faint";

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            try {
              await action();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed");
            }
          })
        }
        className={`${base} ${styles}`}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
