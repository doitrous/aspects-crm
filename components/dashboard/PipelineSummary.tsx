import Link from "next/link";
import { STAGE_META, STAGE_ORDER } from "@/lib/badges";
import type { PipelineStage } from "@/lib/types";

const STAGE_PATH: Record<PipelineStage, string> = {
  new: "/leads",
  qualified: "/qualified",
  booked: "/booked",
  follow_up: "/follow-up",
  post_op: "/post-op",
  lost: "/lost",
};

export function PipelineSummary({ counts, websiteBookings = 0, unconfirmedAppointments = 0, className = "" }: { counts: Record<PipelineStage, number>; websiteBookings?: number; unconfirmedAppointments?: number; className?: string }) {
  const supplemental = [
    { key: "website", label: "Website Bookings", value: websiteBookings, href: "/reservations", bg: "#eff8ff", fg: "#175cd3" },
    { key: "unconfirmed", label: "Unconfirmed Appointments", value: unconfirmedAppointments, href: "/reservations?status=reserved", bg: "#fffaeb", fg: "#b54708" },
  ];
  return (
    <section className={className}>
      <h2 className="mb-2 font-display text-[18px] font-semibold text-clinic-ink">Pipeline</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {STAGE_ORDER.map((stage) => {
          const meta = STAGE_META[stage];
          return (
            <Link
              key={stage}
              href={STAGE_PATH[stage]}
              className="rounded-card border border-line bg-panel p-4 shadow-card hover:border-primary/40"
            >
              <span className="inline-flex rounded-pill px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: meta.bg, color: meta.fg }}>
                {meta.label}
              </span>
              <div className="mt-2 text-[24px] font-bold text-ink-900">{counts[stage]}</div>
            </Link>
          );
        })}
        {supplemental.map((item) => <Link key={item.key} href={item.href} className="rounded-card border border-line bg-panel p-4 shadow-card hover:border-primary/40"><span className="inline-flex rounded-pill px-2 py-0.5 text-[10.5px] font-semibold" style={{background:item.bg,color:item.fg}}>{item.label}</span><div className="mt-2 text-[24px] font-bold text-ink-900">{item.value}</div></Link>)}
      </div>
    </section>
  );
}
