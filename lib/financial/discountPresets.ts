import { clamp } from "./money";

/** Exactly four moderator presets when an allowance exists; one neutral option at 0%. */
export function discountPresets(maxAllowedDiscountPct: number): number[] {
  const max = clamp(maxAllowedDiscountPct, 0, 100);
  if (max === 0) return [0];
  return [0, max * 0.5, max * 0.75, max].map((value) => Math.round(value * 100) / 100);
}
