"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import type { User } from "@/lib/types";
import type { SwitchableUser } from "@/components/shell/UserSwitcher";
import type { Theme } from "@/lib/i18n/config";
import { trapTabKey } from "@/lib/accessibility/focusTrap";

interface MobileMenuState {
  open: boolean;
  toggle: () => void;
}

const MobileMenuContext = createContext<MobileMenuState>({ open: false, toggle: () => undefined });

export function useMobileMenu() {
  return useContext(MobileMenuContext);
}

export function MobileShell({ children, modal, counts, user, accounts, canImpersonate, impersonating, theme }: {
  children: React.ReactNode; modal: React.ReactNode; counts: Record<string, number>; user: User;
  accounts: SwitchableUser[]; canImpersonate: boolean; impersonating: boolean; theme: Theme;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) document.getElementById("mobile-navigation-trigger")?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.querySelector<HTMLElement>("[data-mobile-nav-close]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      trapTabKey(event, document.getElementById("crm-navigation"));
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return <MobileMenuContext.Provider value={{ open, toggle: () => setOpen((value) => !value) }}>
    <div className="flex h-[100dvh] overflow-hidden bg-panel">
      {open && <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-ink-900/45 md:hidden" />}
      <Sidebar counts={counts} user={user} accounts={accounts} canImpersonate={canImpersonate} impersonating={impersonating} theme={theme} mobileOpen={open} navigationActive={desktop || open} onMobileClose={() => setOpen(false)} />
      <main aria-hidden={open || undefined} className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
      {modal}
    </div>
  </MobileMenuContext.Provider>;
}
