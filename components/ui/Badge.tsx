import type { BadgeStyle } from "@/lib/badges";
import { cn } from "@/lib/cn";

export function Badge({
  style,
  className,
  children,
}: {
  style?: BadgeStyle;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        className,
      )}
      style={style ? { background: style.bg, color: style.fg } : undefined}
    >
      {style?.dot && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: style.dot }}
        />
      )}
      {children ?? style?.label}
    </span>
  );
}
