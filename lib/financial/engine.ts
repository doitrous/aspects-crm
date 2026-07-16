/**
 * Central financial calculation engine (spec §11).
 *
 * The SINGLE source of truth for every derived money figure on a lead's
 * Payments/Financials tab and in the financial reports. UI code and API routes
 * must call this — they must never re-derive totals, discounts, or profit
 * inline, and must never trust a computed total submitted by the browser.
 *
 * Design guarantees:
 *  - Decimal-safe: all arithmetic goes through {@link ./money} (integer minor
 *    units), so results are exact to the cent.
 *  - Total functions: any non-finite or missing input degrades to `0`; there is
 *    no `NaN`/`Infinity` path and no throw.
 *  - Pure: no I/O, no env, no clock — identical on server and in tests.
 *
 * Money model (all amounts in major currency units, e.g. EGP):
 *  - `baseServicePrice` — frozen list price captured at record creation
 *    (independent CRM pricing, §2). Never re-read from current settings.
 *  - `quotedPrice` — the MANUALLY agreed price after discount (§1B). Not forced
 *    to any computed value.
 *  - Discount is derived, not entered: `discountAmount = base - quoted`,
 *    `effectiveDiscountPct = (base - quoted) / base × 100`.
 */

import {
  addMoney,
  clamp,
  finite,
  pctOf,
  pctRatio,
  roundMoney,
  subMoney,
} from "./money";

/** A single financial transaction line (append-only ledger, §1E). */
export type TransactionKind =
  | "payment" // patient pays toward the bill
  | "refund" // money returned to the patient
  | "reversal" // a prior payment reversed
  | "chargeback" // bank/card chargeback
  | "credit_note" // non-cash credit that reduces amount due
  | "cancellation_adjustment" // non-cash write-down after a cancellation
  | "doctor_funded"; // doctor personally pays part of the patient bill (§1H)

/** Non-cash kinds that reduce what the patient owes without money changing hands. */
const CREDIT_KINDS: TransactionKind[] = ["credit_note", "cancellation_adjustment"];

/** Kinds that take money back out of what was collected. */
const REVERSAL_KINDS: TransactionKind[] = ["refund", "reversal", "chargeback"];

/** Lifecycle of one payment line (§1C). Only `completed` money is real money. */
export type TransactionStatus = "pending" | "completed" | "failed" | "cancelled";

export interface TransactionInput {
  kind: TransactionKind;
  /** Always the positive magnitude; `kind` decides the direction. */
  amount: number;
  /**
   * Defaults to `"completed"`. A `pending` line is recorded and shown, but it
   * has NOT settled: it must not reduce the patient's outstanding balance, or a
   * moderator could clear a bill by entering a payment that never lands.
   * `failed` / `cancelled` lines are retained (§1E: originals are never deleted)
   * and contribute nothing.
   */
  status?: TransactionStatus;
}

/** What a percentage-based doctor compensation is a percentage OF (§6, §7). */
export type CompensationBasis = "quoted_price" | "net_after_consumables";

/** One doctor's compensation line for a service/bundle (§6, §7). */
export interface DoctorCompensationInput {
  doctorId: string;
  kind: "percentage" | "fixed";
  /** Percentage `0..100` when `kind === "percentage"`, else a fixed amount. */
  value: number;
  /** For percentage lines; defaults to `"quoted_price"`. */
  basis?: CompensationBasis;
}

export interface FinancialInput {
  /** Frozen base list price (§2). */
  baseServicePrice: number;
  /** Manually agreed price after discount; `null` = not yet quoted (§1B). */
  quotedPrice: number | null;
  /** Resolved max allowed discount for this lead (§3 rule precedence), `0..100`. */
  maxAllowedDiscountPct: number;
  transactions?: TransactionInput[];
  /** Total consumable cost for the service/bundle (§8). */
  consumablesTotal?: number;
  doctorCompensations?: DoctorCompensationInput[];
  /** Sum of external cost lines (§9). */
  externalCostsTotal?: number;
}

export interface DoctorCompensationResult {
  doctorId: string;
  kind: "percentage" | "fixed";
  amount: number;
}

export interface FinancialSummary {
  // ── pricing & discount (§1B) ──────────────────────────────
  baseServicePrice: number;
  /** `0` when not yet quoted. */
  quotedPrice: number;
  hasQuote: boolean;
  /** `base - quoted`. Negative means a surcharge (quoted above list). */
  discountAmount: number;
  /** `(base - quoted) / base × 100`; `0` when base is `0`. */
  effectiveDiscountPct: number;
  maxAllowedDiscountPct: number;
  /** `base × (1 - maxPct/100)` — the lowest price allowed without approval. */
  minAllowedQuotedPrice: number;
  /** `true` when a quote is below the allowed minimum → needs approval/override. */
  isBelowAllowed: boolean;

  // ── payments (§1C–E, H) ───────────────────────────────────
  grossPaid: number;
  /** Payment lines still awaiting settlement. Excluded from every total below. */
  pendingTotal: number;
  reversalsTotal: number;
  /** `grossPaid - reversalsTotal` — net patient cash actually kept. */
  actualPaid: number;
  /** Non-cash credits + cancellation adjustments; reduce `amountDue`. */
  creditsTotal: number;
  doctorFundedTotal: number;
  /** `quoted - credits` — what the patient is on the hook for. */
  amountDue: number;
  /** `actualPaid + doctorFunded` — everything collected against the bill. */
  totalCollected: number;
  /** `amountDue - totalCollected`. Positive = still owed; negative = overpaid. */
  outstanding: number;
  /** Positive amount still due. Never negative. */
  balanceDue: number;
  /** Positive overpayment retained for future accounting. Never negative. */
  patientCredit: number;

  // ── costs & profitability (§8, §9, §11) ───────────────────
  consumablesTotal: number;
  doctorCompensations: DoctorCompensationResult[];
  doctorCompensationTotal: number;
  externalCostsTotal: number;
  /** `quoted - consumables`. */
  netAfterConsumables: number;
  /** `quoted - consumables - doctorComp - external`. */
  netProfit: number;
}

/** A line counts as real money only once it has settled. Absent status = settled. */
function isSettled(t: TransactionInput): boolean {
  return (t.status ?? "completed") === "completed";
}

/** Sum the positive magnitudes of every SETTLED transaction whose kind is in `kinds`. */
function sumByKind(txns: TransactionInput[], kinds: TransactionKind[]): number {
  return addMoney(
    ...txns
      .filter((t) => isSettled(t) && kinds.includes(t.kind))
      .map((t) => Math.abs(finite(t.amount))),
  );
}

/** Compute every derived financial figure for one lead. Pure and total. */
export function computeFinancials(input: FinancialInput): FinancialSummary {
  const base = roundMoney(input.baseServicePrice);
  const hasQuote = input.quotedPrice != null && Number.isFinite(input.quotedPrice);
  const quoted = hasQuote ? roundMoney(input.quotedPrice as number) : 0;

  // Pricing & discount
  // An absent quote is a neutral state, not a deliberate 100% discount.
  const discountAmount = hasQuote ? subMoney(base, quoted) : 0;
  const effectiveDiscountPct = hasQuote ? pctRatio(discountAmount, base) : 0;
  const maxAllowedDiscountPct = clamp(input.maxAllowedDiscountPct, 0, 100);
  const minAllowedQuotedPrice = roundMoney(
    base * (1 - maxAllowedDiscountPct / 100),
  );
  // Compare at cent precision so an exactly-allowed quote is never flagged.
  const isBelowAllowed = hasQuote && quoted < minAllowedQuotedPrice;

  // Payments ledger
  const txns = input.transactions ?? [];
  const pendingTotal = addMoney(
    ...txns
      .filter((t) => t.status === "pending" && t.kind === "payment")
      .map((t) => Math.abs(finite(t.amount))),
  );
  const grossPaid = sumByKind(txns, ["payment"]);
  const reversalsTotal = sumByKind(txns, REVERSAL_KINDS);
  const actualPaid = subMoney(grossPaid, reversalsTotal);
  const creditsTotal = sumByKind(txns, CREDIT_KINDS);
  const doctorFundedTotal = sumByKind(txns, ["doctor_funded"]);
  // The saved quote is final once present; until then, the current service
  // total is the amount due. This keeps a new bill financially meaningful
  // without pretending the moderator has already agreed a quote.
  const amountDue = subMoney(hasQuote ? quoted : base, creditsTotal);
  const totalCollected = addMoney(actualPaid, doctorFundedTotal);
  const outstanding = subMoney(amountDue, totalCollected);
  const balanceDue = Math.max(0, outstanding);
  const patientCredit = Math.max(0, roundMoney(totalCollected - amountDue));

  // Costs & profitability
  const consumablesTotal = roundMoney(input.consumablesTotal ?? 0);
  const netAfterConsumables = subMoney(quoted, consumablesTotal);

  const doctorCompensations: DoctorCompensationResult[] = (
    input.doctorCompensations ?? []
  ).map((dc) => ({
    doctorId: dc.doctorId,
    kind: dc.kind,
    amount:
      dc.kind === "fixed"
        ? roundMoney(dc.value)
        : pctOf(
            dc.basis === "net_after_consumables" ? netAfterConsumables : quoted,
            dc.value,
          ),
  }));
  const doctorCompensationTotal = addMoney(
    ...doctorCompensations.map((d) => d.amount),
  );
  const externalCostsTotal = roundMoney(input.externalCostsTotal ?? 0);
  const netProfit = subMoney(
    subMoney(netAfterConsumables, doctorCompensationTotal),
    externalCostsTotal,
  );

  return {
    baseServicePrice: base,
    quotedPrice: quoted,
    hasQuote,
    discountAmount,
    effectiveDiscountPct,
    maxAllowedDiscountPct,
    minAllowedQuotedPrice,
    isBelowAllowed,
    grossPaid,
    pendingTotal,
    reversalsTotal,
    actualPaid,
    creditsTotal,
    doctorFundedTotal,
    amountDue,
    totalCollected,
    outstanding,
    balanceDue,
    patientCredit,
    consumablesTotal,
    doctorCompensations,
    doctorCompensationTotal,
    externalCostsTotal,
    netAfterConsumables,
    netProfit,
  };
}
