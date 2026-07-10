/**
 * Quoted-price validation (spec §"QUOTED PRICE").
 *
 * The quoted price is entered by hand — the app never computes it for the user.
 * This module decides what the UI must show and what the server must allow when
 * the hand-entered figure discounts more deeply than the resolved rule permits:
 *
 *   - the input turns red and a warning names the exact numbers involved
 *     (effective discount %, max allowed discount %, minimum allowed price);
 *   - the moderator is offered escalation through the existing escalation system;
 *   - an authorized admin/auditor may force-approve, which the caller must gate
 *     behind a confirmation carrying a mandatory reason.
 *
 * Pure and total: no I/O, no clock. The same function backs the client-side
 * warning and the server-side authorization, so the two can never disagree —
 * the browser's verdict is advisory, the server re-runs this before writing.
 */

import { computeFinancials } from "./engine";
import { roundMoney } from "./money";

export type QuoteStatus =
  /** No price entered yet. */
  | "empty"
  /** Not a usable money value (negative, NaN, ±Infinity). */
  | "invalid"
  /** Within the allowed discount. */
  | "ok"
  /** Discounts deeper than the rule allows — needs escalation or a force-approval. */
  | "below_allowed";

export interface QuoteEvaluation {
  status: QuoteStatus;
  /** True when the input should render in its error state. */
  isError: boolean;
  /** `(base - quoted) / base × 100`, rounded to 2dp for display. */
  effectiveDiscountPct: number;
  maxAllowedDiscountPct: number;
  /** The lowest price allowed without an approval. */
  minAllowedQuotedPrice: number;
  /** How far below {@link minAllowedQuotedPrice} the quote falls; `0` when allowed. */
  shortfall: number;
  /** Quoted above the list price (a surcharge, not a discount). Never an error. */
  isSurcharge: boolean;
  /** Human-readable explanation, or `null` when there is nothing to say. */
  message: string | null;
  /** The moderator may raise this through the escalation system. */
  canEscalate: boolean;
  /** This viewer holds `financial.forceExceptionalPrice` AND the quote needs it. */
  canForce: boolean;
}

export interface QuoteContext {
  baseServicePrice: number;
  /** The hand-entered price; `null`/`""` while the field is blank. */
  quotedPrice: number | null;
  maxAllowedDiscountPct: number;
  /** Does the viewer hold `financial.forceExceptionalPrice`? */
  viewerCanForce: boolean;
}

/** 2dp for display; the engine keeps full precision internally. */
function pct(n: number): number {
  return Math.round(n * 100) / 100;
}

function money(n: number): string {
  return roundMoney(n).toLocaleString("en-EG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Evaluate a hand-entered quoted price against the resolved discount rule.
 *
 * `below_allowed` is reported even to a viewer who can force-approve — the
 * warning is the point. `canForce` only says who may proceed past it.
 */
export function evaluateQuote(ctx: QuoteContext): QuoteEvaluation {
  const base = roundMoney(ctx.baseServicePrice);
  const summary = computeFinancials({
    baseServicePrice: base,
    quotedPrice: ctx.quotedPrice,
    maxAllowedDiscountPct: ctx.maxAllowedDiscountPct,
  });

  const shared = {
    effectiveDiscountPct: pct(summary.effectiveDiscountPct),
    maxAllowedDiscountPct: pct(summary.maxAllowedDiscountPct),
    minAllowedQuotedPrice: summary.minAllowedQuotedPrice,
    shortfall: 0,
    isSurcharge: false,
    canEscalate: false,
    canForce: false,
  };

  if (ctx.quotedPrice === null || !Number.isFinite(ctx.quotedPrice)) {
    return {
      ...shared,
      status: ctx.quotedPrice === null ? "empty" : "invalid",
      isError: ctx.quotedPrice !== null,
      effectiveDiscountPct: 0,
      message: ctx.quotedPrice === null ? null : "Enter a valid amount.",
    };
  }

  if (ctx.quotedPrice < 0) {
    return {
      ...shared,
      status: "invalid",
      isError: true,
      effectiveDiscountPct: 0,
      message: "A quoted price cannot be negative.",
    };
  }

  if (summary.isBelowAllowed) {
    const shortfall = roundMoney(summary.minAllowedQuotedPrice - summary.quotedPrice);
    return {
      ...shared,
      status: "below_allowed",
      isError: true,
      shortfall,
      canEscalate: true,
      canForce: ctx.viewerCanForce,
      message:
        `This quote discounts ${pct(summary.effectiveDiscountPct)}%, but only ` +
        `${pct(summary.maxAllowedDiscountPct)}% is allowed. The minimum allowed price is ` +
        `${money(summary.minAllowedQuotedPrice)} — this is ${money(shortfall)} below it.`,
    };
  }

  const isSurcharge = summary.quotedPrice > base;
  return {
    ...shared,
    status: "ok",
    isError: false,
    isSurcharge,
    message: isSurcharge
      ? `This quote is ${money(summary.quotedPrice - base)} above the ${money(base)} list price.`
      : null,
  };
}
