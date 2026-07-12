"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue>({ locale: "en", setLocale: () => undefined, t: (k) => k });

/** Provides the active locale + translator to client components under the shell. */
export function I18nProvider({ locale: initialLocale, children }: { locale: Locale; children: ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key) => translate(locale, key) }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
