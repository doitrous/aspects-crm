/**
 * Pure KPI formulas for the Auditor Dashboard (§A). No I/O — the DB layer
 * (`lib/data/auditor.ts`) gathers the raw counts for a given day and passes
 * them here, so the arithmetic is unit-testable in isolation.
 *
 * FORMULAS (all percentages rounded to one decimal; guard divide-by-zero → 0):
 *   qualification %      = qualified_leads / total_leads * 100
 *   booking %            = booked_leads    / total_leads * 100
 *   drop-off %           = dropped_leads   / total_leads * 100
 *   booking conversion % = booked_leads    / qualified_leads * 100
 *   CPL                  = marketing_spend / total_leads
 *   cost per booking     = marketing_spend / booked_leads
 *   cost per qualified   = marketing_spend / qualified_leads
 *
 * `marketing_spend_egp` has no source table in the CRM, so it defaults to 0 and
 * is an auditor-entered / overridable value (the "manual entry" mode). CPL and
 * the cost-per-* metrics are therefore 0 until spend is supplied — never faked.
 * `total_payment_egp` is real collected patient payments for the day.
 */

export interface AuditorRawCounts {
  totalLeads: number;
  qualifiedLeads: number;
  bookedLeads: number;
  droppedLeads: number;
  escalations: number;
  paymentsCollectedEgp: number;
  marketingSpendEgp: number;
  targetCplEgp: number;
}

export type AuditorMetrics = Record<string, number>;

function pct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function per(spend: number, count: number): number {
  if (!count || count <= 0) return 0;
  return Math.round((spend / count) * 100) / 100;
}

/** Compute the full auto-metric snapshot from a day's raw counts. */
export function computeAuditorMetrics(raw: AuditorRawCounts): AuditorMetrics {
  return {
    total_leads: raw.totalLeads,
    qualified_leads: raw.qualifiedLeads,
    booked_leads: raw.bookedLeads,
    dropped_leads: raw.droppedLeads,
    escalations_sent: raw.escalations,
    total_payment_egp: raw.paymentsCollectedEgp,
    marketing_spend_egp: raw.marketingSpendEgp,
    target_cpl: raw.targetCplEgp,
    qualification_percent: pct(raw.qualifiedLeads, raw.totalLeads),
    booking_percent: pct(raw.bookedLeads, raw.totalLeads),
    drop_off_percent: pct(raw.droppedLeads, raw.totalLeads),
    booking_conversion_rate: pct(raw.bookedLeads, raw.qualifiedLeads),
    cpl: per(raw.marketingSpendEgp, raw.totalLeads),
    cost_per_booking: per(raw.marketingSpendEgp, raw.bookedLeads),
    cost_per_qualified_lead: per(raw.marketingSpendEgp, raw.qualifiedLeads),
  };
}

/**
 * Red-flag evaluation: which metrics breach a healthy threshold for the day.
 * Used to highlight problems on the dashboard. Returns the set of metric keys
 * that are flagged plus a short reason each.
 */
export function auditorRedFlags(
  metrics: AuditorMetrics,
): Array<{ key: string; reason: string }> {
  const flags: Array<{ key: string; reason: string }> = [];
  const target = metrics.target_cpl ?? 0;
  if (target > 0 && metrics.cpl > target) {
    flags.push({ key: "cpl", reason: `CPL ${metrics.cpl} exceeds target ${target}` });
  }
  if (metrics.total_leads > 0 && metrics.drop_off_percent >= 50) {
    flags.push({ key: "drop_off_percent", reason: `Drop-off ${metrics.drop_off_percent}% is high` });
  }
  if (metrics.total_leads >= 5 && metrics.booking_percent < 10) {
    flags.push({ key: "booking_percent", reason: `Booking rate ${metrics.booking_percent}% is low` });
  }
  if (metrics.escalations_sent >= 3) {
    flags.push({ key: "escalations_sent", reason: `${metrics.escalations_sent} escalations raised` });
  }
  return flags;
}

/** Merge an auto snapshot with the auditor's overrides (override wins per key). */
export function mergeOverrides(
  auto: AuditorMetrics,
  overrides: AuditorMetrics,
): AuditorMetrics {
  const merged: AuditorMetrics = { ...auto, ...overrides };
  // Derived metrics that depend on an overridden input must be recomputed so an
  // overridden spend/lead-count is reflected in CPL et al.
  const spend = merged.marketing_spend_egp ?? 0;
  merged.cpl = per(spend, merged.total_leads ?? 0);
  merged.cost_per_booking = per(spend, merged.booked_leads ?? 0);
  merged.cost_per_qualified_lead = per(spend, merged.qualified_leads ?? 0);
  merged.qualification_percent = pct(merged.qualified_leads ?? 0, merged.total_leads ?? 0);
  merged.booking_percent = pct(merged.booked_leads ?? 0, merged.total_leads ?? 0);
  merged.drop_off_percent = pct(merged.dropped_leads ?? 0, merged.total_leads ?? 0);
  merged.booking_conversion_rate = pct(merged.booked_leads ?? 0, merged.qualified_leads ?? 0);
  return merged;
}
