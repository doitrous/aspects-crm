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

export function PipelineSummary({ counts, className = "" }: { counts: Record<PipelineStage, number>; className?: string }) {
  return (
    <section className={className}>
      <h2 className="mb-2 font-display text-[18px] font-semibold text-clinic-ink">Pipeline</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {STAGE_ORDER.map((stage) => {
          const meta = STAGE_META[stage];
          return (
            <Link
              key={stage}
              href={STAGE_PATH[stage]}
              className="rounded-card border border-line bg-panel p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40"
            >
              <span className="inline-flex rounded-pill px-2 py-0.5 text-[10.5px] font-semibold" style={{ background: meta.bg, color: meta.fg }}>
                {meta.label}
              </span>
              <div className="mt-2 text-[24px] font-bold text-ink-900">{counts[stage]}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
