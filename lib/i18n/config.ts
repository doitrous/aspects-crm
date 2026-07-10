/** Interface preferences shared by server + client. Pure (no next/headers). */

export type Locale = "en" | "ar";
export type Theme = "light" | "dark";

export const LOCALE_COOKIE = "crm_locale";
export const THEME_COOKIE = "crm_theme";

export const LOCALES: Locale[] = ["en", "ar"];
export const THEMES: Theme[] = ["light", "dark"];

export function normalizeLocale(v: string | undefined | null): Locale {
  return v === "ar" ? "ar" : "en";
}
export function normalizeTheme(v: string | undefined | null): Theme {
  return v === "dark" ? "dark" : "light";
}

/** Arabic is right-to-left; everything else is left-to-right. */
export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
