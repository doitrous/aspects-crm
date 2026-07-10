export function EmptyState({
  icon = "✓",
  title,
  hint,
}: {
  icon?: string;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-line-faint text-lg text-ink-400">
        {icon}
      </div>
      <div className="text-[13px] font-semibold text-ink-700">{title}</div>
      {hint && <div className="text-[12px] text-ink-400">{hint}</div>}
    </div>
  );
}
