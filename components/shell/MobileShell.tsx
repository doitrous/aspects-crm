"use client";

import { createContext, useContext, useState } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import type { User } from "@/lib/types";
import type { SwitchableUser } from "@/components/shell/UserSwitcher";
import type { Theme } from "@/lib/i18n/config";

const MobileMenuContext = createContext<() => void>(() => undefined);

export function useMobileMenu() {
  return useContext(MobileMenuContext);
}

export function MobileShell({ children, modal, counts, user, accounts, canImpersonate, impersonating, theme }: {
  children: React.ReactNode; modal: React.ReactNode; counts: Record<string, number>; user: User;
  accounts: SwitchableUser[]; canImpersonate: boolean; impersonating: boolean; theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  return <MobileMenuContext.Provider value={() => setOpen((value) => !value)}>
    <div className="flex h-[100dvh] overflow-hidden bg-panel">
      {open && <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-ink-900/45 backdrop-blur-[1px] md:hidden" />}
      <Sidebar counts={counts} user={user} accounts={accounts} canImpersonate={canImpersonate} impersonating={impersonating} theme={theme} mobileOpen={open} onMobileClose={() => setOpen(false)} />
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      {modal}
    </div>
  </MobileMenuContext.Provider>;
}
