"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

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
  action: () => Promise<void | { error?: string | null }>;
  label: string;
  pendingLabel?: string;
  tone?: "primary" | "ghost";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

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
              const result = await action();
              if (result && result.error) throw new Error(result.error);
              router.refresh();
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
