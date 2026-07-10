import "server-only";
import { cookies } from "next/headers";
import {
  LOCALE_COOKIE,
  THEME_COOKIE,
  normalizeLocale,
  normalizeTheme,
  type Locale,
  type Theme,
} from "@/lib/i18n/config";

/** Resolve the request's interface preferences from cookies (SSR source of truth). */
export async function getPreferences(): Promise<{ locale: Locale; theme: Theme }> {
  const jar = await cookies();
  return {
    locale: normalizeLocale(jar.get(LOCALE_COOKIE)?.value),
    theme: normalizeTheme(jar.get(THEME_COOKIE)?.value),
  };
}
