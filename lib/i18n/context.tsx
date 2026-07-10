"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

interface I18nValue {
  locale: Locale;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nValue>({ locale: "en", t: (k) => k });

/** Provides the active locale + translator to client components under the shell. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value: I18nValue = { locale, t: (key) => translate(locale, key) };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
