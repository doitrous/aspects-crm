"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
export function PreferencesMenu({ locale, theme }: { locale: Locale; theme: Theme }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { t } = useI18n();

  function applyLocale(next: Locale) {
    setCookie(LOCALE_COOKIE, next);
    const root = document.documentElement;
    root.lang = next;
    root.dir = dirFor(next);
    startTransition(() => router.refresh());
  }

  function applyTheme(next: Theme) {
    setCookie(THEME_COOKIE, next);
    document.documentElement.dataset.theme = next;
    startTransition(() => router.refresh());
  }

  const segBtn = (active: boolean) =>
    "flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors " +
    (active ? "bg-primary text-white" : "text-ink-500 hover:bg-line-faint");

  return (
    <div className={"mt-auto flex flex-col gap-2 border-t border-line-soft pt-3 " + (pending ? "opacity-70" : "")}>
      <div>
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
          {t("pref.language")}
        </div>
        <div className="flex gap-1 rounded-lg bg-line-faint/60 p-0.5">
          <button onClick={() => applyLocale("en")} className={segBtn(locale === "en")}>English</button>
          <button onClick={() => applyLocale("ar")} className={segBtn(locale === "ar")}>العربية</button>
        </div>
      </div>
      <div>
        <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
          {t("pref.theme")}
        </div>
        <div className="flex gap-1 rounded-lg bg-line-faint/60 p-0.5">
          <button onClick={() => applyTheme("light")} className={segBtn(theme === "light")}>☀ {t("pref.light")}</button>
          <button onClick={() => applyTheme("dark")} className={segBtn(theme === "dark")}>☾ {t("pref.dark")}</button>
        </div>
      </div>
    </div>
  );
}
