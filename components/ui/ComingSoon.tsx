import { Topbar } from "@/components/shell/Topbar";

export function ComingSoon({
  title,
  phase,
  summary,
}: {
  title: string;
  phase: string;
  summary: string;
}) {
  return (
    <>
      <Topbar title={title} />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-2xl text-primary">
          ✦
        </div>
        <div className="font-display text-[20px] font-semibold text-clinic-ink">{title}</div>
        <div className="max-w-md text-[13px] text-ink-500">{summary}</div>
        <span className="rounded-pill bg-line-faint px-3 py-1 text-[11.5px] font-semibold text-ink-500">
          Scheduled for {phase}
        </span>
      </div>
    </>
  );
}
