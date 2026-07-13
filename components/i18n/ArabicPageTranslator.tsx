"use client";

import { useLayoutEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { ARABIC_PATTERNS, ARABIC_UI } from "@/lib/i18n/uiArabic";

const PROTECTED = "[data-patient-content], [data-no-translate], script, style, code, pre";
const originalText = new Map<Text, string>();
const originalAttributes = new Map<Element, Map<string, string>>();

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
    const text = root as Text;
    const parent = root.parentElement;
    if (isProtected(parent)) return;
    const current = text.textContent ?? "";
    const previous = originalText.get(text);
    if (previous && translation(previous) === current) return;
    const next = translation(current);
    if (next && next !== current) {
      originalText.set(text, current);
      text.textContent = next;
    }
    return;
  }
  if (!(root instanceof Element) || isProtected(root)) return;

  for (const attr of ["placeholder", "title", "aria-label"] as const) {
    const value = root.getAttribute(attr);
    const previous = originalAttributes.get(root)?.get(attr);
    if (previous && translation(previous) === value) continue;
    const next = value ? translation(value) : null;
    if (next && next !== value) {
      const attributes = originalAttributes.get(root) ?? new Map<string, string>();
      attributes.set(attr, value!);
      originalAttributes.set(root, attributes);
      root.setAttribute(attr, next);
    }
  }
  if (root.matches("input, textarea")) return;
  for (const child of Array.from(root.childNodes)) translateTree(child);
}

function releaseTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) originalText.delete(root as Text);
  if (root instanceof Element) originalAttributes.delete(root);
  for (const child of Array.from(root.childNodes)) releaseTree(child);
}

function restoreEnglish(): void {
  for (const [text, original] of originalText) {
    if (text.isConnected && text.textContent === translation(original)) {
      text.textContent = original;
    }
  }
  originalText.clear();

  for (const [element, attributes] of originalAttributes) {
    if (!element.isConnected) continue;
    for (const [attr, original] of attributes) {
      if (element.getAttribute(attr) === translation(original)) {
        element.setAttribute(attr, original);
      }
    }
  }
  originalAttributes.clear();
}

/** Translates shared CRM UI copy while preserving all patient-entered content. */
export function ArabicPageTranslator() {
  const { locale } = useI18n();

  useLayoutEffect(() => {
    if (locale !== "ar") {
      restoreEnglish();
      return;
    }
    // Translate before paint. Locale switching no longer waits for a server
    // refresh, and newly streamed/navigation content is translated as it lands.
    translateTree(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") translateTree(record.target);
        for (const node of Array.from(record.addedNodes)) translateTree(node);
        for (const node of Array.from(record.removedNodes)) releaseTree(node);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
    };
  }, [locale]);

  return null;
}
