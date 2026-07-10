import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { DuplicateCard } from "@/components/queues/DuplicateCard";
import { duplicateQueue } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const pairs = await duplicateQueue();
  const open = pairs.filter((p) => p.status === "suspected");
  const resolved = pairs.filter((p) => p.status !== "suspected");

  return (
    <>
      <Topbar title="Duplicates Review" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="mb-3 text-[11.5px] text-ink-400">
          {open.length} to review · {resolved.length} resolved
        </div>

        {pairs.length === 0 ? (
          <EmptyState
            title="No duplicate flags"
            hint="Suspected duplicates surface here automatically as leads arrive."
          />
        ) : (
          <div className="space-y-6">
            {open.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-display text-[16px] font-semibold text-clinic-ink">
                  Needs review
                </h2>
                {open.map((p) => (
                  <DuplicateCard key={p.id} pair={p} />
                ))}
              </section>
            )}

            {resolved.length > 0 && (
              <section className="space-y-3">
                <h2 className="font-display text-[16px] font-semibold text-clinic-ink">
                  Resolved
                </h2>
                {resolved.map((p) => (
                  <DuplicateCard key={p.id} pair={p} />
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}
