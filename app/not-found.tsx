import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <div className="font-display text-[22px] font-semibold text-clinic-ink">
        Not found
      </div>
      <p className="text-[13px] text-ink-500">
        We couldn&apos;t find that page or lead.
      </p>
      <Link
        href="/dashboard"
        className="rounded-control bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-hover"
      >
        ← Back to dashboard
      </Link>
    </div>
  );
}
