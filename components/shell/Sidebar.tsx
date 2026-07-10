"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, visibleNav } from "@/lib/nav";
import type { User } from "@/lib/types";
import { UserSwitcher, type SwitchableUser } from "@/components/shell/UserSwitcher";
import { cn } from "@/lib/cn";

export function Sidebar({
  counts,
  user,
  accounts,
  canImpersonate,
  impersonating,
}: {
  counts: Record<string, number>;
  user: User;
  accounts: SwitchableUser[];
  canImpersonate: boolean;
  impersonating: boolean;
}) {
  const pathname = usePathname();
  const nav = visibleNav(user.role);
  const current = activeHref(pathname, nav);

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
        const active = current === n.href;
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

      <div className="mt-auto">
        <UserSwitcher
          current={user}
          accounts={accounts}
          canImpersonate={canImpersonate}
          impersonating={impersonating}
        />
      </div>
    </aside>
  );
}
