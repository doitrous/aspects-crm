"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleNav } from "@/lib/nav";
import { currentUser } from "@/lib/data/reference";
import { cn } from "@/lib/cn";

export function Sidebar({ counts }: { counts: Record<string, number> }) {
  const pathname = usePathname();
  const nav = visibleNav(currentUser.role);

  return (
    <aside className="flex w-[210px] flex-none flex-col gap-0.5 border-r border-line-soft bg-sidebar px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-hover text-[14px] font-extrabold text-white">
          A
        </div>
        <div className="text-[14px] font-bold leading-tight text-ink-900">
          Aspects Clinica
          <div className="text-[10px] font-medium text-ink-400">CRM</div>
        </div>
      </div>

      {nav.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        const count = n.countKey ? counts[n.countKey] : undefined;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors",
              active
                ? "bg-primary-soft font-semibold text-primary"
                : "font-medium text-ink-600 hover:bg-line-faint",
            )}
          >
            <span className="w-4 text-center text-[13px]">{n.icon}</span>
            {n.label}
            {count ? (
              <span
                className={cn(
                  "ml-auto font-mono text-[10.5px] font-semibold",
                  active ? "text-primary" : "text-ink-400",
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}

      <div className="mt-auto flex items-center gap-2.5 border-t border-line-soft px-2 pt-3">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-primary-avatar text-[11px] font-bold text-primary">
          {currentUser.initials}
        </div>
        <div className="text-[11.5px] font-semibold text-ink-700">
          {currentUser.name}
          <div className="text-[10.5px] font-normal capitalize text-ink-400">
            {currentUser.role}
          </div>
        </div>
      </div>
    </aside>
  );
}
