"use client";

export default function ReportsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="flex flex-1 items-center justify-center bg-canvas p-5"><div className="w-full max-w-lg rounded-2xl border border-red-200 bg-white p-6 text-center shadow-card"><h2 className="text-xl font-black text-ink-900">Reports are temporarily unavailable</h2><p className="mt-2 text-sm text-ink-500">The page caught a reporting-data error instead of closing the CRM. Retry now; if it continues, verify the reporting database tables.</p><button onClick={reset} className="mt-4 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">Retry reports</button></div></div>;
}
