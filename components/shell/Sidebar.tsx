"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { activeHref, NAV_SECTION_LABELS, visibleNav } from "@/lib/nav";
import type { User } from "@/lib/types";
import { UserSwitcher, type SwitchableUser } from "@/components/shell/UserSwitcher";
import { PreferencesMenu } from "@/components/shell/PreferencesMenu";
import { useI18n } from "@/lib/i18n/context";
import type { Theme } from "@/lib/i18n/config";
import { cn } from "@/lib/cn";

export function Sidebar({
  counts,
  user,
  accounts,
  canImpersonate,
  impersonating,
  theme,
  mobileOpen = false,
  navigationActive = true,
  onMobileClose,
}: {
  counts: Record<string, number>;
  user: User;
  accounts: SwitchableUser[];
  canImpersonate: boolean;
  impersonating: boolean;
  theme: Theme;
  mobileOpen?: boolean;
  navigationActive?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const nav = visibleNav(user.role);
  const current = activeHref(pathname, nav);
  const { t } = useI18n();

  return (
    <aside id="crm-navigation" role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen || undefined} aria-hidden={!navigationActive || undefined} inert={!navigationActive || undefined} aria-label="Main navigation" className={cn("fixed inset-y-0 left-0 z-50 flex w-[min(86vw,280px)] flex-none flex-col gap-0.5 border-r border-line-soft bg-sidebar px-3 py-4 shadow-2xl transition-transform duration-200 md:static md:z-auto md:w-[210px] md:translate-x-0 md:shadow-none", mobileOpen ? "translate-x-0" : "-translate-x-full")}>
      <div className="flex items-center justify-center px-2 pb-5 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/aspects-clinica-logo.png" alt="Aspects Clinica" className="h-20 w-full object-contain" />
        <button data-mobile-nav-close type="button" onClick={onMobileClose} aria-label="Close menu" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full border border-line-soft bg-panel text-lg text-ink-600 md:hidden">×</button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto pr-0.5">
      {nav.map((n, index) => {
        const active = current === n.href;
        const booked = n.href === "/booked";
        const lost = n.href === "/lost";
        const count = n.countKey ? counts[n.countKey] : undefined;
        const startsSection = index === 0 || nav[index - 1].section !== n.section;
        return (<div key={n.href} className={startsSection && index > 0 ? "mt-2 border-t border-line-faint pt-2" : ""}>
          {startsSection && <div className="mb-1 px-2.5 text-[9px] font-bold uppercase tracking-[0.14em] text-ink-300">{NAV_SECTION_LABELS[n.section]}</div>}
          <Link
            href={n.href}
            onClick={onMobileClose}
            className={cn(
              "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] transition-colors md:min-h-0",
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
        </div>);
      })}
      </nav>

      <div className="mt-2 flex flex-col gap-2 border-t border-line-faint pt-2">
        <PreferencesMenu theme={theme} />
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
