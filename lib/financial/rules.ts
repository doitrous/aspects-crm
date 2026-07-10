/**
 * Hierarchical discount-rule resolution (spec §3).
 *
 * When a lead needs its "max allowed discount", the effective rule is chosen by
 * specificity, most specific first:
 *   1. moderator + service   (this moderator, this service)
 *   2. moderator             (this moderator, any service)
 *   3. service               (any moderator, this service)
 *   4. global default        (fallback)
 *
 * Pure and total: with no matching rule and no global default, the resolved max
 * discount is `0` (nothing may be discounted without an explicit rule).
 */

import { clamp } from "./money";

/**
 * A stable key for "which service is this?".
 *
 * The live schema stores a service as a soft `service_id` uuid (when it maps to
 * a booking-website service) OR a bare `service_name` (when it does not). Rules
 * and leads must be compared on the same key or a name-only rule would never
 * match a name-only lead. The uuid wins when present; otherwise the trimmed,
 * lower-cased name. Returns `null` when neither identifies a service.
 */
export function serviceKey(
  serviceId: string | null | undefined,
  serviceName: string | null | undefined,
): string | null {
  if (serviceId) return serviceId;
  const name = serviceName?.trim().toLowerCase();
  return name ? name : null;
}

/** An optional `[from, to]` validity window, inclusive on both ends. */
export interface EffectiveWindow {
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/**
 * Is a dated rule in force on `onDate`? Both bounds are optional and inclusive.
 * Dates are ISO `YYYY-MM-DD`, which compares correctly as a string.
 */
export function isEffective(window: EffectiveWindow, onDate: string): boolean {
  if (window.effectiveFrom && onDate < window.effectiveFrom) return false;
  if (window.effectiveTo && onDate > window.effectiveTo) return false;
  return true;
}

export type DiscountScope =
  | "moderator_service"
  | "moderator"
  | "service"
  | "global";

export interface DiscountRule {
  scope: DiscountScope;
  moderatorId?: string | null;
  serviceId?: string | null;
  /** Max allowed discount for this scope, `0..100`. */
  maxDiscountPct: number;
}

export interface DiscountContext {
  moderatorId?: string | null;
  serviceId?: string | null;
}

/** Priority weight — higher wins. */
const SCOPE_PRIORITY: Record<DiscountScope, number> = {
  moderator_service: 4,
  moderator: 3,
  service: 2,
  global: 1,
};

/** Does a rule apply to this context? */
function matches(rule: DiscountRule, ctx: DiscountContext): boolean {
  switch (rule.scope) {
    case "moderator_service":
      return (
        !!rule.moderatorId &&
        rule.moderatorId === ctx.moderatorId &&
        !!rule.serviceId &&
        rule.serviceId === ctx.serviceId
      );
    case "moderator":
      return !!rule.moderatorId && rule.moderatorId === ctx.moderatorId;
    case "service":
      return !!rule.serviceId && rule.serviceId === ctx.serviceId;
    case "global":
      return true;
  }
}

export interface ResolvedDiscount {
  maxDiscountPct: number;
  rule: DiscountRule | null;
}

/**
 * Resolve the effective max-discount rule for a context. Among all matching
 * rules, the highest-priority scope wins; ties keep the first in input order.
 */
export function resolveMaxDiscount(
  rules: DiscountRule[],
  ctx: DiscountContext,
): ResolvedDiscount {
  let best: DiscountRule | null = null;
  for (const rule of rules) {
    if (!matches(rule, ctx)) continue;
    if (best === null || SCOPE_PRIORITY[rule.scope] > SCOPE_PRIORITY[best.scope]) {
      best = rule;
    }
  }
  return {
    maxDiscountPct: best ? clamp(best.maxDiscountPct, 0, 100) : 0,
    rule: best,
  };
}
