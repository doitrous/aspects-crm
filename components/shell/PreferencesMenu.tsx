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
    "flex h-7 min-w-0 flex-1 items-center justify-center rounded-md px-1 text-[10px] font-bold transition-all " +
    (active ? "bg-panel text-primary shadow-sm ring-1 ring-line" : "text-ink-500 hover:text-ink-800");

  return (
    <div className="mt-auto border-t border-line-soft pt-2">
      <div role="group" className="grid grid-cols-4 gap-0.5 rounded-lg border border-line-soft bg-toolbar p-0.5" aria-label={`${t("pref.language")} · ${t("pref.theme")}`}>
        <button type="button" title={t("pref.english")} aria-label={t("pref.english")} aria-pressed={locale === "en"} onClick={() => applyLocale("en")} className={segBtn(locale === "en")}>EN</button>
        <button type="button" title={t("pref.arabic")} aria-label={t("pref.arabic")} aria-pressed={locale === "ar"} onClick={() => applyLocale("ar")} className={segBtn(locale === "ar")}>AR</button>
        <button type="button" title={t("pref.light")} aria-label={t("pref.light")} aria-pressed={activeTheme === "light"} onClick={() => applyTheme("light")} className={segBtn(activeTheme === "light")}>☀</button>
        <button type="button" title={t("pref.dark")} aria-label={t("pref.dark")} aria-pressed={activeTheme === "dark"} onClick={() => applyTheme("dark")} className={segBtn(activeTheme === "dark")}>☾</button>
      </div>
    </div>
  );
}
