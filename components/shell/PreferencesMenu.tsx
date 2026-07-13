"use client";

import { useState } from "react";
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  dirFor,
  type Locale,
  type Theme,
} from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/context";

/** One-year persisted cookie, readable by the SSR layout on the next request. */
function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * Language + theme switch in the sidebar. Applies the change to the live DOM
 * immediately (no flash) AND persists a cookie, then refreshes so server
 * components re-render in the new locale/theme. The SSR `<html>` attributes are
 * the source of truth on the next request.
 */
export function PreferencesMenu({ theme }: { theme: Theme }) {
  const [activeTheme, setActiveTheme] = useState(theme);
  const { locale, setLocale, t } = useI18n();

  function applyLocale(next: Locale) {
    setLocale(next);
    setCookie(LOCALE_COOKIE, next);
    const root = document.documentElement;
    root.lang = next;
    root.dir = dirFor(next);
  }

  function applyTheme(next: Theme) {
    setActiveTheme(next);
    setCookie(THEME_COOKIE, next);
    document.documentElement.dataset.theme = next;
  }

  const segBtn = (active: boolean) =>
    "flex-1 rounded-control px-2 py-1.5 text-[11px] font-semibold transition-all " +
    (active ? "bg-panel text-primary shadow-sm ring-1 ring-line" : "text-ink-500 hover:text-ink-800");

  return (
    <div className="mt-auto flex flex-col gap-2 border-t border-line-soft pt-3">
      <div>
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
          {t("pref.language")}
        </div>
        <div className="flex gap-1 rounded-control border border-line-soft bg-toolbar p-1">
          <button type="button" aria-pressed={locale === "en"} onClick={() => applyLocale("en")} className={segBtn(locale === "en")}><span className="me-1 font-mono">EN</span> English</button>
          <button type="button" aria-pressed={locale === "ar"} onClick={() => applyLocale("ar")} className={segBtn(locale === "ar")}><span className="me-1 font-mono">AR</span> العربية</button>
        </div>
      </div>
      <div>
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
          {t("pref.theme")}
        </div>
        <div className="flex gap-1 rounded-control border border-line-soft bg-toolbar p-1">
          <button type="button" aria-pressed={activeTheme === "light"} onClick={() => applyTheme("light")} className={segBtn(activeTheme === "light")}>☀ {t("pref.light")}</button>
          <button type="button" aria-pressed={activeTheme === "dark"} onClick={() => applyTheme("dark")} className={segBtn(activeTheme === "dark")}>☾ {t("pref.dark")}</button>
        </div>
      </div>
    </div>
  );
}
