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
