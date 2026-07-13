"use client";

import { useMobileMenu } from "@/components/shell/MobileShell";

export function Topbar({
  title,
  overdue,
  unread,
  action,
}: {
  title: string;
  overdue?: number;
  unread?: number;
  action?: React.ReactNode;
}) {
  const mobileMenu = useMobileMenu();
  return (
    <div className="flex min-h-[56px] flex-none items-center gap-2 border-b border-line-soft px-3 sm:h-[58px] sm:gap-3 sm:px-[18px]">
      <button id="mobile-navigation-trigger" type="button" onClick={mobileMenu.toggle} aria-label="Open navigation" aria-expanded={mobileMenu.open} aria-controls="crm-navigation" className="flex h-11 w-11 flex-none items-center justify-center rounded-lg border border-line-soft bg-panel text-[19px] font-black tracking-[-2px] text-ink-700 shadow-sm md:hidden">•••</button>
      <h1 className="truncate text-[15px] font-bold text-ink-900 sm:text-[16px]">{title}</h1>

      <div className="flex-1" />

      {overdue ? (
        <div className="hidden items-center gap-1.5 rounded-pill bg-danger-bg px-2.5 py-1.5 text-[11px] font-semibold text-danger sm:flex">
          <span className="h-[7px] w-[7px] rounded-full bg-danger-dot" />
          {overdue} overdue
        </div>
      ) : null}

      {unread ? (
        <div className="hidden items-center gap-1.5 rounded-pill bg-primary-soft px-2.5 py-1.5 text-[11px] font-semibold text-primary sm:flex">
          {unread} unread
        </div>
      ) : null}

      {action}
    </div>
  );
}
