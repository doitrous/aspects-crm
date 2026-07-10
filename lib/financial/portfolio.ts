import { addMoney, roundMoney, subMoney, pctRatio } from "@/lib/financial/money";

/**
 * Pure portfolio aggregation for the Financial Dashboard. No I/O and no
 * `server-only`, so it is unit-testable; the DB reader (`financialDashboard.ts`)
 * feeds it summed figures. Uses the shared money helpers so the arithmetic
 * matches the per-lead engine (`lib/financial/engine.ts`).
 */

export interface ProfitabilityInput {
  baseServicePrices: number[];
  quotedPrices: number[]; // recognized patient revenue basis (quoted price)
  consumablesTotal: number;
  doctorCompensationTotal: number;
  externalCostsTotal: number;
}

export interface ProfitabilitySummary {
  grossServiceValue: number;
  totalQuotedValue: number;
  totalDiscounts: number;
  recognizedRevenue: number;
  consumablesTotal: number;
  doctorCompensationTotal: number;
  externalCostsTotal: number;
  totalDirectCosts: number;
  netRevenue: number;
  netMarginPercent: number;
  recordCount: number;
}

/** Fold per-record figures into a portfolio summary. Pure + total (no NaN). */
export function computeProfitability(input: ProfitabilityInput): ProfitabilitySummary {
  const grossServiceValue = addMoney(...input.baseServicePrices);
  const totalQuotedValue = addMoney(...input.quotedPrices);
  const recognizedRevenue = totalQuotedValue; // recognized revenue = agreed quoted price
  const totalDiscounts = roundMoney(Math.max(0, subMoney(grossServiceValue, totalQuotedValue)));
  const totalDirectCosts = addMoney(
    input.consumablesTotal,
    input.doctorCompensationTotal,
    input.externalCostsTotal,
  );
  const netRevenue = subMoney(recognizedRevenue, totalDirectCosts);
  const netMarginPercent = pctRatio(netRevenue, recognizedRevenue);
  return {
    grossServiceValue,
    totalQuotedValue,
    totalDiscounts,
    recognizedRevenue,
    consumablesTotal: roundMoney(input.consumablesTotal),
    doctorCompensationTotal: roundMoney(input.doctorCompensationTotal),
    externalCostsTotal: roundMoney(input.externalCostsTotal),
    totalDirectCosts,
    netRevenue,
    netMarginPercent,
    recordCount: input.quotedPrices.length,
  };
}
