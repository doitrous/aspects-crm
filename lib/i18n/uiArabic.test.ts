import assert from "node:assert/strict";
import test from "node:test";
import { ARABIC_PATTERNS, ARABIC_UI } from "./uiArabic";

function translateUi(value: string): string {
  const exact = ARABIC_UI[value];
  if (exact) return exact;
  for (const [pattern, render] of ARABIC_PATTERNS) {
    const match = value.match(pattern);
    if (match) return render(match);
  }
  return value;
}

test("dynamic report copy is translated without changing its values", () => {
  assert.equal(translateUi("Incoming leads: 1000"), "العملاء الواردون: 1000");
  assert.equal(translateUi("Marketing Report — 2026-07-13"), "تقرير التسويق اليومي — 2026-07-13");
  assert.equal(translateUi("Jul 13, 2026 · 8:22 PM"), "يوليو 13, 2026 · 8:22 م");
});

test("dynamic financial audit copy is translated without changing audit facts", () => {
  assert.equal(translateUi("Use max · 10%"), "استخدم الحد الأقصى · 10%");
  assert.equal(translateUi("changed status from pending to completed"), "غيّر الحالة من قيد الانتظار إلى مكتملة");
  assert.equal(translateUi("(admin)"), "(مدير)");
});
