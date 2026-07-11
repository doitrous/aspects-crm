"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, visibleNav } from "@/lib/nav";
import type { User } from "@/lib/types";
import { UserSwitcher, type SwitchableUser } from "@/components/shell/UserSwitcher";
import { PreferencesMenu } from "@/components/shell/PreferencesMenu";
import { useI18n } from "@/lib/i18n/context";
import type { Locale, Theme } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";

export function Sidebar({
  counts,
  user,
  accounts,
  canImpersonate,
  impersonating,
  locale,
  theme,
}: {
  counts: Record<string, number>;
  user: User;
  accounts: SwitchableUser[];
  canImpersonate: boolean;
  impersonating: boolean;
  locale: Locale;
  theme: Theme;
}) {
  const pathname = usePathname();
  const nav = visibleNav(user.role);
  const current = activeHref(pathname, nav);
  const { t } = useI18n();

  return (
    <aside className="flex w-[210px] flex-none flex-col gap-0.5 border-r border-line-soft bg-sidebar px-3 py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/aspects-clinica-logo.png" alt="Aspects Clinica" className="h-10 w-14 flex-none object-contain" />
        <div className="text-[14px] font-bold leading-tight text-ink-900">
          Aspects Clinica
          <div className="text-[10px] font-medium text-ink-400">{t("shell.crm")}</div>
        </div>
      </div>

      {nav.map((n) => {
        const active = current === n.href;
        const booked = n.href === "/booked";
        const lost = n.href === "/lost";
        const count = n.countKey ? counts[n.countKey] : undefined;
        return (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors",
              active && booked
                ? "bg-success font-semibold text-white shadow-sm ring-1 ring-success/30"
                : active && lost
                  ? "bg-danger font-semibold text-white shadow-sm ring-1 ring-danger/30"
                  : active
                    ? "bg-primary-hover font-semibold text-white shadow-sm ring-1 ring-primary/30"
                    : booked
                      ? "bg-success/5 font-semibold text-success hover:bg-success/10"
                      : lost
                        ? "bg-danger-bg font-semibold text-danger hover:bg-danger/10"
                        : "font-medium text-ink-600 hover:bg-line-faint",
            )}
          >
            <span className="w-4 text-center text-[13px]">{n.icon}</span>
            {t(n.i18nKey)}
            {count ? (
              <span
                className={cn(
                  "ml-auto font-mono text-[10.5px] font-semibold",
                  active ? "text-white/80" : "text-ink-400",
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}

      <div className="mt-auto flex flex-col gap-2">
        <PreferencesMenu locale={locale} theme={theme} />
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
