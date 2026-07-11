"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { ARABIC_PATTERNS, ARABIC_UI } from "@/lib/i18n/uiArabic";

const PROTECTED = "[data-patient-content], [data-no-translate], script, style, code, pre";

function translation(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const exact = ARABIC_UI[trimmed];
  if (exact) return value.replace(trimmed, exact);
  for (const [pattern, render] of ARABIC_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) return value.replace(trimmed, render(match));
  }
  return null;
}

function isProtected(element: Element | null): boolean {
  return Boolean(element?.closest(PROTECTED));
}

function translateTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) {
    const parent = root.parentElement;
    if (isProtected(parent)) return;
    const next = translation(root.textContent ?? "");
    if (next && next !== root.textContent) root.textContent = next;
    return;
  }
  if (!(root instanceof Element) || isProtected(root)) return;

  for (const attr of ["placeholder", "title", "aria-label"] as const) {
    const value = root.getAttribute(attr);
    const next = value ? translation(value) : null;
    if (next) root.setAttribute(attr, next);
  }
  if (root.matches("input, textarea")) return;
  for (const child of Array.from(root.childNodes)) translateTree(child);
}

/** Translates shared CRM UI copy while preserving all patient-entered content. */
export function ArabicPageTranslator() {
  const { locale } = useI18n();

  useEffect(() => {
    if (locale !== "ar") return;
    let observer: MutationObserver | null = null;
    // The CRM uses streamed Server Components. Wait until their hydration has
    // settled so translating SSR text cannot create a hydration mismatch.
    const timer = window.setTimeout(() => {
      translateTree(document.body);
      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") translateTree(record.target);
          for (const node of Array.from(record.addedNodes)) translateTree(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }, 750);
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [locale]);

  return null;
}
