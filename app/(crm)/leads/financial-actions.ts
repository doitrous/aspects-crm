"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/permissions";
import { ActorError } from "@/lib/data/actor";
import {
  addConsumable,
  addDoctorFundedPayment,
  addExternalCost,
  addTransaction,
  decideDiscountApproval,
  FinancialError,
  requestDiscountApproval,
  saveQuote,
  setTransactionStatus,
  type ExternalCostCategory,
  type PaymentMethod,
} from "@/lib/data/financials";
import type { TransactionKind, TransactionStatus } from "@/lib/financial/engine";

export interface FinancialActionState {
  error: string | null;
  ok: string | null;
}

/**
 * Expected refusals (a bad amount, a below-allowed quote, a missing reason)
 * become form errors. Anything else — a dropped connection, a genuine bug — is
 * rethrown so it surfaces as a 500 rather than a misleading "could not save".
 */
function toState(err: unknown): FinancialActionState {
  if (err instanceof FinancialError || err instanceof ActorError) {
    return { error: err.message, ok: null };
  }
  if (err instanceof PermissionError) {
    return { error: "You do not have permission to change financial records.", ok: null };
  }
  throw err;
}

/** Both the drawer and the full page render the same data, so revalidate both. */
function revalidateLead(leadId: string): void {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? "").trim();
const money = (fd: FormData, k: string): number => Number(str(fd, k));
const flag = (fd: FormData, k: string): boolean => str(fd, k) === "true";

/**
 * Save the manually entered quoted price.
 *
 * `force` is only a request: `saveQuote` re-resolves the discount ceiling and
 * re-checks the capability server-side, so a moderator posting `force=true` by
 * hand is refused exactly as if the button had never been rendered.
 *
 * A field the form did not submit is left `undefined` rather than sent as
 * `null` — otherwise saving a price from the quote editor, which carries no
 * service-date or notes input, would silently erase both.
 */
export async function saveQuoteAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  if (!leadId) return { error: "Missing lead.", ok: null };

  try {
    await saveQuote({
      leadId,
      quotedPrice: money(formData, "quotedPrice"),
      force: flag(formData, "force"),
      reason: str(formData, "reason") || undefined,
      ...(formData.has("serviceDate") ? { serviceDate: str(formData, "serviceDate") || null } : {}),
      ...(formData.has("financialNotes")
        ? { financialNotes: str(formData, "financialNotes") || null }
        : {}),
    });
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  return { error: null, ok: "Quoted price saved." };
}

const KINDS: TransactionKind[] = [
  "payment",
  "refund",
  "reversal",
  "chargeback",
  "credit_note",
  "cancellation_adjustment",
];
const METHODS: PaymentMethod[] = [
  "cash",
  "visa",
  "instapay",
  "mobile_wallet",
  "bank_transfer",
  "other",
];
const STATUSES: TransactionStatus[] = ["pending", "completed", "failed", "cancelled"];

/** Append one line to the money ledger: a payment, refund, reversal, credit… */
export async function addTransactionAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  const kind = str(formData, "kind") as TransactionKind;
  const method = str(formData, "method") as PaymentMethod;
  const status = str(formData, "status") as TransactionStatus;

  if (!leadId) return { error: "Missing lead.", ok: null };
  if (!KINDS.includes(kind)) return { error: `"${kind}" is not a transaction type.`, ok: null };
  if (method && !METHODS.includes(method)) {
    return { error: `"${method}" is not a payment method.`, ok: null };
  }
  if (status && !STATUSES.includes(status)) {
    return { error: `"${status}" is not a payment status.`, ok: null };
  }

  try {
    await addTransaction({
      leadId,
      kind,
      amount: money(formData, "amount"),
      method: method || null,
      status: status || "completed",
      occurredOn: str(formData, "occurredOn") || undefined,
      reference: str(formData, "reference") || null,
      receiptNumber: str(formData, "receiptNumber") || null,
      note: str(formData, "note") || null,
      reversesTransactionId: str(formData, "reversesTransactionId") || null,
    });
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  return { error: null, ok: "Transaction recorded." };
}

/** Settle or void a pending payment. The amount itself can never be edited. */
export async function setTransactionStatusAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  const transactionId = str(formData, "transactionId");
  const status = str(formData, "status") as TransactionStatus;

  if (!leadId || !transactionId) return { error: "Missing transaction.", ok: null };
  if (!STATUSES.includes(status)) return { error: `"${status}" is not a payment status.`, ok: null };

  try {
    await setTransactionStatus(transactionId, status, str(formData, "reason") || undefined);
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  return { error: null, ok: `Payment marked ${status}.` };
}

/** Record a payment the doctor personally made toward the patient's bill. */
export async function addDoctorFundedAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  if (!leadId) return { error: "Missing lead.", ok: null };

  try {
    await addDoctorFundedPayment({
      leadId,
      doctorId: str(formData, "doctorId"),
      doctorName: str(formData, "doctorName") || null,
      amount: money(formData, "amount"),
      occurredOn: str(formData, "occurredOn") || undefined,
      note: str(formData, "note") || null,
      reference: str(formData, "reference") || null,
      reducesPatientBalance: flag(formData, "reducesPatientBalance"),
    });
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  return { error: null, ok: "Doctor payment recorded." };
}

/** Add a consumable line. A patient-specific override requires a reason. */
export async function addConsumableAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  if (!leadId) return { error: "Missing lead.", ok: null };

  try {
    await addConsumable({
      leadId,
      description: str(formData, "description"),
      quantity: Number(str(formData, "quantity") || "1"),
      unitCost: money(formData, "unitCost"),
      isOverride: flag(formData, "isOverride"),
      overrideReason: str(formData, "overrideReason") || undefined,
    });
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  return { error: null, ok: "Consumable added." };
}

const CATEGORIES: ExternalCostCategory[] = [
  "lab",
  "outside_facility",
  "external_surgeon",
  "anesthetist",
  "imaging",
  "referral_commission",
  "external_provider",
  "other",
];

/** Add an external cost line (lab, outside facility, external surgeon…). */
export async function addExternalCostAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  const category = str(formData, "category") as ExternalCostCategory;

  if (!leadId) return { error: "Missing lead.", ok: null };
  if (!CATEGORIES.includes(category)) {
    return { error: `"${category}" is not a cost category.`, ok: null };
  }

  try {
    await addExternalCost({
      leadId,
      category,
      description: str(formData, "description"),
      amount: money(formData, "amount"),
      vendor: str(formData, "vendor") || null,
      occurredOn: str(formData, "occurredOn") || undefined,
      notes: str(formData, "notes") || null,
      reference: str(formData, "reference") || null,
    });
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  return { error: null, ok: "External cost added." };
}

/** Escalate a below-allowed quoted price for Admin/Auditor approval. */
export async function requestApprovalAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  if (!leadId) return { error: "Missing lead.", ok: null };

  try {
    await requestDiscountApproval({
      leadId,
      quotedPrice: money(formData, "quotedPrice"),
      reason: str(formData, "reason"),
    });
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  revalidatePath("/escalations");
  return { error: null, ok: "Sent for approval." };
}

/** Approve or reject a below-allowed price. Admin/Auditor only. */
export async function decideApprovalAction(
  _prev: FinancialActionState,
  formData: FormData,
): Promise<FinancialActionState> {
  const leadId = str(formData, "leadId");
  const approvalId = str(formData, "approvalId");
  const decision = str(formData, "decision");

  if (!leadId || !approvalId) return { error: "Missing request.", ok: null };
  if (decision !== "approved" && decision !== "rejected") {
    return { error: "Choose approve or reject.", ok: null };
  }

  const approved = str(formData, "approvedQuotedPrice");
  try {
    await decideDiscountApproval(
      approvalId,
      decision,
      str(formData, "reason"),
      approved ? Number(approved) : undefined,
    );
  } catch (err) {
    return toState(err);
  }

  revalidateLead(leadId);
  revalidatePath("/escalations");
  return { error: null, ok: decision === "approved" ? "Price approved." : "Request rejected." };
}
