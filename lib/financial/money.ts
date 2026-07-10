/**
 * Decimal-safe money helpers.
 *
 * JavaScript numbers are IEEE-754 floats, so naive money arithmetic drifts
 * (`0.1 + 0.2 !== 0.3`). Every monetary value in the financial engine is a
 * plain `number` of MAJOR currency units (e.g. EGP), but all arithmetic funnels
 * through these helpers, which convert to integer minor units (piastres/cents),
 * operate exactly, and convert back. Results are exact to the cent and never
 * `NaN`/`Infinity` — non-finite inputs are treated as `0`.
 *
 * This module is pure (no I/O, no env) so it runs identically on the server and
 * in tests. The financial engine is server-validated; nothing here trusts a
 * client-supplied computed total.
 */

/** Minor units per major unit: 2 decimal places. */
const SCALE = 100;

/** Coerce any non-finite value (`NaN`, `±Infinity`) to `0`. */
export function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Major units → integer minor units, half-away-from-zero rounding. */
function toMinor(amount: number): number {
  const scaled = finite(amount) * SCALE;
  // Nudge the magnitude outward by a tiny, scale-relative epsilon so a value
  // that is a hair below a half-cent boundary purely from float representation
  // error (e.g. 1.005 → 100.49999999…) still rounds as the intended 1.01. The
  // epsilon (≈1e-9 at small magnitudes, growing relatively) dwarfs float error
  // yet is far smaller than any genuine 2dp gap, so real values are untouched.
  const eps = Math.abs(scaled) * 1e-12 + 1e-9;
  const nudged = scaled + Math.sign(scaled) * eps;
  return Math.sign(nudged) * Math.round(Math.abs(nudged));
}

/** Round a major-unit amount to the nearest cent (half-away-from-zero). */
export function roundMoney(amount: number): number {
  return toMinor(amount) / SCALE;
}

/** Exact sum of money values (each snapped to the cent first). */
export function addMoney(...amounts: number[]): number {
  return amounts.reduce((acc, a) => acc + toMinor(a), 0) / SCALE;
}

/** Exact `a - b` at cent precision. */
export function subMoney(a: number, b: number): number {
  return (toMinor(a) - toMinor(b)) / SCALE;
}

/** `amount × ratio` (unitless ratio, e.g. `0.15`), rounded to the cent. */
export function mulMoney(amount: number, ratio: number): number {
  return roundMoney(finite(amount) * finite(ratio));
}

/** `pct`% of `amount`, where `pct` is `0..100`. Safe for `pct = 0`. */
export function pctOf(amount: number, pct: number): number {
  return roundMoney(finite(amount) * (finite(pct) / 100));
}

/**
 * What percentage `part` is of `whole` (`0..100`), unrounded.
 * Safe zero-denominator: returns `0` when `whole === 0` (never `Infinity`/`NaN`).
 */
export function pctRatio(part: number, whole: number): number {
  const w = finite(whole);
  if (w === 0) return 0;
  return (finite(part) / w) * 100;
}

/** Clamp a number to `[min, max]`; non-finite input becomes `min`. */
export function clamp(n: number, min: number, max: number): number {
  const v = finite(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}
