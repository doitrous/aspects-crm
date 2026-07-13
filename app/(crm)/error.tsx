"use client";

import { useEffect } from "react";

export default function CrmError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("CRM page failed", { digest: error.digest, name: error.name });
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center bg-canvas p-6" role="alert">
      <div className="w-full max-w-md rounded-card border border-line-soft bg-panel p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-danger-bg text-xl text-danger">!</div>
        <h1 className="mt-3 text-lg font-black text-ink-900">Something interrupted this page</h1>
        <p className="mt-2 text-sm text-ink-500">If this happened during an import or save, review the latest results before retrying because completed rows may already be saved.</p>
        <button type="button" onClick={reset} className="mt-5 min-h-11 rounded-control bg-primary px-5 text-sm font-bold text-white hover:bg-primary-hover">
          Reload page
        </button>
      </div>
    </div>
  );
}
