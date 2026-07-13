"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  addConsumableAction,
  addDoctorFundedAction,
  addExternalCostAction,
  addTransactionAction,
  clearQuoteAction,
  deleteTransactionAction,
  deleteFinancialLineAction,
  decideApprovalAction,
  requestApprovalAction,
  saveQuoteAction,
  setTransactionStatusAction,
  updateTransactionAction,
  updateFinancialLineAction,
  type FinancialActionState,
} from "@/app/(crm)/leads/financial-actions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type {
  ApprovalRequest,
  ExternalCostCategory,
  LeadFinancials,
  PaymentLine,
} from "@/lib/data/financials";
import { evaluateQuote } from "@/lib/financial/quote";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, formatMoney, formatPct } from "@/lib/format";

/* ── labels ───────────────────────────────────────────────────── */

const KIND_LABEL: Record<string, string> = {
  payment: "Payment",
  refund: "Refund",
  reversal: "Reversal",
  chargeback: "Chargeback",
  credit_note: "Credit note",
  cancellation_adjustment: "Cancellation adjustment",
  doctor_funded: "Paid by doctor",
};

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  visa: "Visa",
  instapay: "InstaPay",
  mobile_wallet: "Mobile Wallet",
  bank_transfer: "Bank transfer",
  other: "Other",
};

const CATEGORY_LABEL: Record<ExternalCostCategory, string> = {
  lab: "Lab",
  outside_facility: "Outside facility",
  external_surgeon: "External surgeon",
  anesthetist: "Anesthetist",
  imaging: "Imaging",
  referral_commission: "Referral commission",
  external_provider: "External provider",
  other: "Other",
};

const SCOPE_LABEL: Record<string, string> = {
  moderator_service: "this moderator, on this service",
  moderator: "this moderator",
  service: "this service",
  global: "the clinic default",
};

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-success/10 text-success",
  pending: "bg-warn/10 text-warn",
  failed: "bg-danger-bg text-danger",
  cancelled: "bg-danger-bg text-danger",
};

const IDLE: FinancialActionState = { error: null, ok: null };

/* ── small primitives ─────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success" | "warn";
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-panel px-3 py-2">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-[13px] font-semibold tabular-nums",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success",
          tone === "warn" && "text-warn",
          !tone && "text-ink-900",
        )}
      >
        {value}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-line px-2.5 py-1.5 text-[13px] text-ink-900 outline-none focus:border-primary";
const btnCls =
  "rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-50";
const btnGhost =
  "rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-line-faint disabled:opacity-50";

function Feedback({ state }: { state: { error: string | null; ok: string | null } }) {
  if (state.error) {
    return <p className="mt-2 text-[12px] font-medium text-danger">{state.error}</p>;
  }
  if (state.ok) {
    return <p className="mt-2 text-[12px] font-medium text-success">{state.ok}</p>;
  }
  return null;
}

function LineControls({ type, id, amount, description, quantity, occurredOn, onChanged }: { type:"consumable"|"doctor_payment"|"external_cost";id:string;amount:number;description?:string;quantity?:number;occurredOn?:string;onChanged?:()=>void }) {
  const [editState,edit,editing]=useActionState(updateFinancialLineAction,IDLE); const [deleteState,remove,deleting]=useActionState(deleteFinancialLineAction,IDLE); useNotifyChanged(editState,onChanged); useNotifyChanged(deleteState,onChanged);
  return <div className="ml-2 flex items-center gap-1"><details><summary className="cursor-pointer list-none text-[10.5px] font-bold text-primary">Modify</summary><form action={edit} className="absolute right-8 z-20 mt-1 grid w-56 gap-1 rounded-lg border border-line-soft bg-white p-3 shadow-xl"><input type="hidden" name="lineType" value={type}/><input type="hidden" name="lineId" value={id}/>{description!==undefined&&<input name="description" defaultValue={description} className={inputCls}/>}<input name="amount" type="number" min="0" step="0.01" defaultValue={amount} className={inputCls}/>{quantity!==undefined&&<input name="quantity" type="number" min="0.01" step="0.01" defaultValue={quantity} className={inputCls}/>} {occurredOn!==undefined&&<input name="occurredOn" type="date" defaultValue={occurredOn} className={inputCls}/>}<button disabled={editing} className={btnCls}>Save</button>{editState.error&&<span className="text-[10px] text-danger">{editState.error}</span>}</form></details><form action={remove}><input type="hidden" name="lineType" value={type}/><input type="hidden" name="lineId" value={id}/><button disabled={deleting} className="text-[10.5px] font-bold text-danger">Delete</button></form>{deleteState.error&&<span className="text-[10px] text-danger">{deleteState.error}</span>}</div>;
}

function useNotifyChanged(state: FinancialActionState, onChanged?: () => void) {
  const callback = useRef(onChanged);
  callback.current = onChanged;
  useEffect(() => {
    if (state.ok) callback.current?.();
  }, [state]);
}

/** Collapsible "Add …" form, so the tab opens as a summary rather than a wall of inputs. */
function AddPanel({ label, children, tone = "default" }: { label: string; children: React.ReactNode; tone?: "default" | "transaction" | "consumable" }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className={cn(
        btnGhost,
        tone === "transaction" && "border-primary/40 bg-primary-soft font-bold text-primary shadow-sm hover:border-primary hover:bg-primary/10",
        tone === "consumable" && "border-success/40 bg-success/10 font-bold text-success shadow-sm hover:border-success hover:bg-success/15",
      )} onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-line-soft bg-toolbar p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink-700">{label}</span>
        <button type="button" className="text-[12px] text-ink-400" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {children}
    </div>
  );
}

/* ── §5 quote editor ──────────────────────────────────────────── */

/**
 * The manually entered quoted price.
 *
 * The verdict is recomputed on every keystroke from the same pure
 * {@link evaluateQuote} the server runs before it writes, so what the moderator
 * sees and what the server enforces can never disagree. This copy is advisory:
 * posting past it is refused server-side.
 */
function QuoteEditor({ fin, onChanged }: { fin: LeadFinancials; onChanged?: () => void }) {
  const [saveState, save, saving] = useActionState(saveQuoteAction, IDLE);
  const [escState, escalate, escalating] = useActionState(requestApprovalAction, IDLE);
  const [clearState, clear, clearing] = useActionState(clearQuoteAction, IDLE);
  useNotifyChanged(saveState, onChanged);
  useNotifyChanged(escState, onChanged);
  useNotifyChanged(clearState, onChanged);

  const [raw, setRaw] = useState(fin.summary.hasQuote ? String(fin.summary.quotedPrice) : "");
  const [confirming, setConfirming] = useState(false);
  const [escalatingOpen, setEscalatingOpen] = useState(false);

  const parsed = raw.trim() === "" ? null : Number(raw);
  const verdict = evaluateQuote({
    baseServicePrice: fin.summary.baseServicePrice,
    quotedPrice: parsed,
    maxAllowedDiscountPct: fin.summary.maxAllowedDiscountPct,
    viewerCanForce: fin.canForce,
  });

  const below = verdict.status === "below_allowed";
  const cur = fin.currency;
  const availableDiscounts = [...new Set([0, 5, 10, fin.summary.maxAllowedDiscountPct])]
    .filter((value) => value >= 0 && value <= fin.summary.maxAllowedDiscountPct)
    .sort((a, b) => a - b);
  const chooseDiscount = (pct: number) => {
    const quoted = Math.round(fin.summary.baseServicePrice * (1 - pct / 100) * 100) / 100;
    setRaw(String(quoted));
  };

  return (
    <section>
      <SectionLabel>1 · Agree the patient price</SectionLabel>

      <div className="mb-3 overflow-hidden rounded-xl border border-primary/25 bg-primary-soft/45">
        <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="text-[10.5px] font-black uppercase tracking-[0.14em] text-primary">Your discount privilege</div>
            <div className="mt-1 text-[22px] font-black text-ink-900">Up to {formatPct(fin.summary.maxAllowedDiscountPct)}</div>
            <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-ink-600">
              You can quote any price down to <strong>{formatMoney(fin.summary.minAllowedQuotedPrice, cur)}</strong> without approval
              {fin.discountRuleScope ? ` under the ${SCOPE_LABEL[fin.discountRuleScope]} rule` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:max-w-[240px] sm:justify-end">
            {availableDiscounts.map((discount) => (
              <button
                key={discount}
                type="button"
                disabled={!fin.canEdit || fin.summary.baseServicePrice <= 0}
                onClick={() => chooseDiscount(discount)}
                className="rounded-control border border-primary/25 bg-white px-3 py-2 text-[11.5px] font-black text-primary hover:border-primary hover:bg-primary hover:text-white disabled:opacity-40"
              >
                {discount === fin.summary.maxAllowedDiscountPct && discount > 0 ? `Use max · ${formatPct(discount)}` : formatPct(discount)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line-soft bg-panel p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-[11px] text-ink-400">Base service price</label>
            <div className="mt-1 text-[15px] font-semibold tabular-nums text-ink-900">
              {formatMoney(fin.summary.baseServicePrice, cur)}
            </div>
            <p className="mt-1 text-[11px] text-ink-400">
              Frozen when this record was created. Re-pricing the service later does not change it.
            </p>
          </div>

          <div>
            <label htmlFor="quotedPrice" className="text-[11px] text-ink-400">
              Patient&apos;s final quoted price
            </label>
            <input
              id="quotedPrice"
              name="quotedPrice"
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              value={raw}
              disabled={!fin.canEdit}
              onChange={(e) => setRaw(e.target.value)}
              aria-invalid={verdict.isError}
              aria-describedby={verdict.message ? "quote-warning" : undefined}
              className={cn(
                inputCls,
                "mt-1 tabular-nums",
                verdict.isError && "border-danger bg-danger-bg text-danger focus:border-danger",
              )}
              placeholder="Enter or choose a discount above"
            />
            {fin.summary.hasQuote && (
              <p className="mt-1 text-[11px] text-ink-400">
                Discount {formatMoney(fin.summary.discountAmount, cur)} (
                {formatPct(fin.summary.effectiveDiscountPct)})
              </p>
            )}
          </div>
        </div>

        {/* The four numbers §5 requires, whenever a quote is below the ceiling. */}
        {below && (
          <div
            id="quote-warning"
            role="alert"
            className="mt-4 rounded-lg border border-danger/30 bg-danger-bg p-3"
          >
            <p className="text-[12px] font-semibold text-danger">Quoted price lower than allowed</p>
            <p className="mt-1 text-[12px] text-danger">{verdict.message}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-3">
              <div>
                <dt className="text-ink-500">Effective discount</dt>
                <dd className="font-semibold tabular-nums text-danger">
                  {formatPct(verdict.effectiveDiscountPct)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Max allowed</dt>
                <dd className="font-semibold tabular-nums text-ink-900">
                  {formatPct(verdict.maxAllowedDiscountPct)}
                </dd>
              </div>
              <div>
                <dt className="text-ink-500">Minimum allowed price</dt>
                <dd className="font-semibold tabular-nums text-ink-900">
                  {formatMoney(verdict.minAllowedQuotedPrice, cur)}
                </dd>
              </div>
            </dl>
            {fin.discountRuleScope && (
              <p className="mt-2 text-[11px] text-ink-500">
                The limit comes from the rule for {SCOPE_LABEL[fin.discountRuleScope]}.
              </p>
            )}
            {!fin.canForce && (
              <p className="mt-2 text-[11px] text-ink-600">
                Escalate this price for an admin or auditor to approve.
              </p>
            )}
          </div>
        )}

        {verdict.status === "invalid" && (
          <p role="alert" className="mt-3 text-[12px] font-medium text-danger">
            {verdict.message}
          </p>
        )}

        {/* Save — plain when in range, gated behind a confirmation when not. */}
        {fin.canEdit && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!below && (
              <form action={save}>
                <input type="hidden" name="leadId" value={fin.leadId} />
                <input type="hidden" name="quotedPrice" value={raw} />
                <button type="submit" className={btnCls} disabled={saving || verdict.status !== "ok"}>
                  {saving ? "Saving…" : "Save quoted price"}
                </button>
              </form>
            )}
            {fin.summary.hasQuote && <form action={clear}><input type="hidden" name="leadId" value={fin.leadId}/><button type="submit" disabled={clearing} className="rounded-md border border-danger/30 bg-danger-bg px-3 py-1.5 text-[12px] font-semibold text-danger">{clearing ? "Deleting…" : "Delete quoted price"}</button></form>}

            {below && verdict.canForce && !confirming && (
              <button type="button" className={btnCls} onClick={() => setConfirming(true)}>
                Approve below-allowed price…
              </button>
            )}

            {below && !escalatingOpen && (
              <button type="button" className={btnGhost} onClick={() => setEscalatingOpen(true)}>
                Escalate for approval
              </button>
            )}
          </div>
        )}

        {/* §5: force-approval demands a strong warning and a written reason. */}
        {confirming && below && (
          <form action={save} className="mt-3 rounded-lg border border-danger/40 bg-danger-bg p-3">
            <p className="text-[12px] font-semibold text-danger">
              You are approving a price below the allowed discount.
            </p>
            <p className="mt-1 text-[12px] text-ink-700">
              This quote is {formatMoney(verdict.shortfall, cur)} below the minimum allowed price of{" "}
              {formatMoney(verdict.minAllowedQuotedPrice, cur)}. It will be recorded against your name,
              flagged on the Admin and Auditor dashboards, and written to the audit log with the old and
              new value. A reason is required.
            </p>
            <input type="hidden" name="leadId" value={fin.leadId} />
            <input type="hidden" name="quotedPrice" value={raw} />
            <input type="hidden" name="force" value="true" />
            <textarea
              name="reason"
              required
              rows={2}
              placeholder="Why is this price being approved?"
              className={cn(inputCls, "mt-2 resize-y")}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-danger px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Approving…" : "I understand — approve this price"}
              </button>
              <button type="button" className={btnGhost} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {escalatingOpen && below && (
          <form action={escalate} className="mt-3 rounded-lg border border-line bg-toolbar p-3">
            <p className="text-[12px] font-semibold text-ink-700">Escalate for approval</p>
            <input type="hidden" name="leadId" value={fin.leadId} />
            <input type="hidden" name="quotedPrice" value={raw} />
            <textarea
              name="reason"
              required
              rows={2}
              placeholder="Why does this patient need a price below the allowed discount?"
              className={cn(inputCls, "mt-2 resize-y")}
            />
            <div className="mt-2 flex gap-2">
              <button type="submit" className={btnCls} disabled={escalating}>
                {escalating ? "Sending…" : "Send for approval"}
              </button>
              <button type="button" className={btnGhost} onClick={() => setEscalatingOpen(false)}>
                Cancel
              </button>
            </div>
            <Feedback state={escState} />
          </form>
        )}

        <Feedback state={saveState} />
        <Feedback state={clearState} />

        {fin.isExceptional && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
            <Badge className="bg-danger-bg text-danger">Quoted price lower than allowed</Badge>
            <span className="text-[11px] text-ink-500">
              Approved by {fin.exceptionalByName ?? "—"}
              {fin.exceptionalAt ? ` on ${formatDateTime(fin.exceptionalAt)}` : ""}
              {fin.exceptionalReason ? ` — "${fin.exceptionalReason}"` : ""}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── ledger ───────────────────────────────────────────────────── */

function PaymentsLedger({ fin, onChanged }: { fin: LeadFinancials; onChanged?: () => void }) {
  const [editState, edit, editing] = useActionState(updateTransactionAction, IDLE);
  const [deleteState, remove, deleting] = useActionState(deleteTransactionAction, IDLE);
  useNotifyChanged(editState, onChanged); useNotifyChanged(deleteState, onChanged);
  const [addState, add, adding] = useActionState(addTransactionAction, IDLE);
  const [statusState, setStatus, settingStatus] = useActionState(setTransactionStatusAction, IDLE);
  const [kind, setKind] = useState("payment");
  useNotifyChanged(addState, onChanged);
  useNotifyChanged(statusState, onChanged);

  const cur = fin.currency;
  const reversible = fin.payments.filter((p) => p.kind === "payment" && p.status === "completed");
  const needsOriginal = kind === "refund" || kind === "reversal" || kind === "chargeback";

  return (
    <section>
      <SectionLabel>Payments</SectionLabel>

      {fin.payments.length === 0 ? (
        <EmptyState icon="₤" title="No payments yet" hint="Deposits, installments and refunds appear here." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line-soft">
          <table className="w-full min-w-[640px] text-left text-[12px]">
            <thead className="bg-toolbar text-[11px] uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Amount</th>
                <th className="px-3 py-2 font-semibold">Method</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 font-semibold">Entered by</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {fin.payments.map((p: PaymentLine) => (
                <tr key={p.id} className="border-t border-line-softer">
                  <td className="px-3 py-2 text-ink-900">
                    {KIND_LABEL[p.kind] ?? p.kind}
                    {p.reversesTransactionId && (
                      <span className="ml-1 text-[10px] text-ink-400">(reverses)</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-semibold tabular-nums text-ink-900">
                    {formatMoney(p.amount, cur)}
                  </td>
                  <td className="px-3 py-2 text-ink-600">{p.method ? METHOD_LABEL[p.method] : "—"}</td>
                  <td className="px-3 py-2 text-ink-600">{formatDate(p.occurredOn)}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-pill px-2 py-0.5 text-[10px] font-semibold capitalize",
                        STATUS_STYLE[p.status],
                      )}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-500">
                    {p.receiptNumber ?? p.reference ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-500">{p.enteredByName}</td>
                  <td className="px-3 py-2 text-right">
                    {/* Only a pending line may change; settled money is reversed, never edited. */}
                    {fin.canEdit && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <details className="text-left"><summary className={`${btnGhost} cursor-pointer list-none`}>Modify</summary><form action={edit} className="absolute right-8 z-20 mt-1 grid w-64 gap-1 rounded-lg border border-line-soft bg-white p-3 shadow-xl"><input type="hidden" name="transactionId" value={p.id}/><input name="amount" type="number" min="0.01" step="0.01" defaultValue={p.amount} className={inputCls}/><select name="method" defaultValue={p.method ?? "cash"} className={inputCls}>{Object.entries(METHOD_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select><input name="occurredOn" type="date" defaultValue={p.occurredOn} className={inputCls}/><input name="note" defaultValue={p.note ?? ""} placeholder="Note" className={inputCls}/><button disabled={editing} className={btnCls}>Save changes</button></form></details>
                        <form action={remove}><input type="hidden" name="transactionId" value={p.id}/><button type="submit" disabled={deleting} className="rounded-md border border-danger/30 bg-danger-bg px-2.5 py-1 text-[12px] font-medium text-danger">Delete</button></form>
                        {p.status === "pending" &&
                        (["completed", "failed", "cancelled"] as const).map((s) => (
                          <form key={s} action={setStatus}>
                            <input type="hidden" name="leadId" value={fin.leadId} />
                            <input type="hidden" name="transactionId" value={p.id} />
                            <input type="hidden" name="status" value={s} />
                            <button type="submit" className={btnGhost} disabled={settingStatus}>
                              {s === "completed" ? "Settle" : s === "failed" ? "Failed" : "Void"}
                            </button>
                          </form>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Feedback state={statusState} />
      <Feedback state={editState} />
      <Feedback state={deleteState} />

      {fin.canEdit && (
        <div className="mt-3">
          <AddPanel label="Add transaction" tone="transaction">
            <form action={add} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="leadId" value={fin.leadId} />

              <label className="text-[11px] text-ink-500">
                Type
                <select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                  className={cn(inputCls, "mt-1")}
                >
                  {["payment", "refund", "reversal", "chargeback", "credit_note", "cancellation_adjustment"].map(
                    (k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label className="text-[11px] text-ink-500">
                Amount
                <input
                  name="amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  className={cn(inputCls, "mt-1 tabular-nums")}
                />
              </label>

              <label className="text-[11px] text-ink-500">
                Method
                <select name="method" className={cn(inputCls, "mt-1")} defaultValue="cash">
                  {Object.entries(METHOD_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-[11px] text-ink-500">
                Status
                <select name="status" className={cn(inputCls, "mt-1")} defaultValue="completed">
                  <option value="completed">Completed</option>
                  <option value="pending">Pending</option>
                </select>
              </label>

              <label className="text-[11px] text-ink-500">
                Payment date
                <input name="occurredOn" type="date" className={cn(inputCls, "mt-1")} />
              </label>

              <label className="text-[11px] text-ink-500">
                Receipt number
                <input name="receiptNumber" className={cn(inputCls, "mt-1")} />
              </label>

              <label className="text-[11px] text-ink-500">
                Transaction reference
                <input name="reference" className={cn(inputCls, "mt-1")} />
              </label>

              {needsOriginal && (
                <label className="text-[11px] text-ink-500">
                  Reverses which payment?
                  <select name="reversesTransactionId" required className={cn(inputCls, "mt-1")}>
                    <option value="">Select a payment…</option>
                    {reversible.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatMoney(p.amount, cur)} — {formatDate(p.occurredOn)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="text-[11px] text-ink-500 sm:col-span-2">
                Financial note
                <input name="note" className={cn(inputCls, "mt-1")} />
              </label>

              <div className="sm:col-span-2">
                <button type="submit" className={btnCls} disabled={adding}>
                  {adding ? "Recording…" : "Record transaction"}
                </button>
                <Feedback state={addState} />
              </div>
            </form>
          </AddPanel>
        </div>
      )}
    </section>
  );
}

/* ── approvals ────────────────────────────────────────────────── */

function Approvals({ fin, onChanged }: { fin: LeadFinancials; onChanged?: () => void }) {
  const [state, decide, deciding] = useActionState(decideApprovalAction, IDLE);
  useNotifyChanged(state, onChanged);
  if (fin.approvals.length === 0) return null;

  return (
    <section>
      <SectionLabel>Price approvals</SectionLabel>
      <div className="flex flex-col gap-2">
        {fin.approvals.map((a: ApprovalRequest) => (
          <div key={a.id} className="rounded-lg border border-line-soft bg-panel p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] text-ink-900">
                <span className="font-semibold tabular-nums">
                  {formatMoney(a.requestedQuotedPrice, fin.currency)}
                </span>{" "}
                requested at {formatPct(a.requestedPct)} discount (max {formatPct(a.maxAllowedPct)})
              </div>
              <Badge
                className={cn(
                  a.status === "pending" && "bg-warn/10 text-warn",
                  a.status === "approved" && "bg-success/10 text-success",
                  a.status === "rejected" && "bg-danger-bg text-danger",
                  a.status === "resolved" && "bg-line-faint text-ink-500",
                )}
              >
                {a.status}
              </Badge>
            </div>
            <p className="mt-1 text-[11px] text-ink-500">
              Asked by {a.requestedByName} on {formatDateTime(a.createdAt)}
              {a.reason ? ` — "${a.reason}"` : ""}
            </p>
            {a.decidedByName && (
              <p className="text-[11px] text-ink-500">
                Decided by {a.decidedByName}
                {a.decidedAt ? ` on ${formatDateTime(a.decidedAt)}` : ""}
                {a.approvedQuotedPrice !== null
                  ? ` at ${formatMoney(a.approvedQuotedPrice, fin.currency)}`
                  : ""}
              </p>
            )}

            {a.status === "pending" && fin.canApprove && (
              <form action={decide} className="mt-2 grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="leadId" value={fin.leadId} />
                <input type="hidden" name="approvalId" value={a.id} />
                <label className="text-[11px] text-ink-500">
                  Approve at (leave blank to grant as requested)
                  <input
                    name="approvedQuotedPrice"
                    type="number"
                    step="0.01"
                    min="0"
                    className={cn(inputCls, "mt-1 tabular-nums")}
                  />
                </label>
                <label className="text-[11px] text-ink-500">
                  Reason (required)
                  <input name="reason" required className={cn(inputCls, "mt-1")} />
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <button
                    type="submit"
                    name="decision"
                    value="approved"
                    className={btnCls}
                    disabled={deciding}
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="rejected"
                    className={btnGhost}
                    disabled={deciding}
                  >
                    Reject
                  </button>
                </div>
              </form>
            )}
          </div>
        ))}
      </div>
      <Feedback state={state} />
    </section>
  );
}

/* ── costs ────────────────────────────────────────────────────── */

function Consumables({ fin, onChanged }: { fin: LeadFinancials; onChanged?: () => void }) {
  const [state, add, adding] = useActionState(addConsumableAction, IDLE);
  const [override, setOverride] = useState(false);
  useNotifyChanged(state, onChanged);

  return (
    <section>
      <SectionLabel>Consumables</SectionLabel>
      {fin.consumables.length === 0 ? (
        <p className="text-[12px] text-ink-400">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {fin.consumables.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-line-softer px-3 py-2 text-[12px]"
            >
              <span className="text-ink-900">
                {c.description}
                <span className="text-ink-400">
                  {" "}
                  × {c.quantity} @ {formatMoney(c.unitCost, fin.currency)}
                </span>
                {c.isOverride && (
                  <Badge className="ml-2 bg-warn/10 text-warn">
                    Override{c.overrideReason ? `: ${c.overrideReason}` : ""}
                  </Badge>
                )}
              </span>
              <span className="flex items-center font-semibold tabular-nums text-ink-900">
                {formatMoney(c.totalCost, fin.currency)}
                {fin.canEditRules && <LineControls type="consumable" id={c.id} amount={c.unitCost} description={c.description} quantity={c.quantity} onChanged={onChanged}/>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {fin.canEditRules && (
        <div className="mt-2">
          <AddPanel label="Add consumable" tone="consumable">
            <form action={add} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="leadId" value={fin.leadId} />
              <label className="text-[11px] text-ink-500 sm:col-span-2">
                Description
                <input name="description" required className={cn(inputCls, "mt-1")} placeholder="Syringe" />
              </label>
              <label className="text-[11px] text-ink-500">
                Quantity
                <input name="quantity" type="number" min="1" step="1" defaultValue={1} className={cn(inputCls, "mt-1")} />
              </label>
              <label className="text-[11px] text-ink-500">
                Unit cost
                <input name="unitCost" type="number" min="0" step="0.01" required className={cn(inputCls, "mt-1 tabular-nums")} />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-ink-500 sm:col-span-2">
                <input
                  type="checkbox"
                  name="isOverride"
                  value="true"
                  checked={override}
                  onChange={(e) => setOverride(e.target.checked)}
                />
                This overrides the service default for this patient
              </label>
              {override && (
                <label className="text-[11px] text-ink-500 sm:col-span-2">
                  Reason for the override (required)
                  <input name="overrideReason" required className={cn(inputCls, "mt-1")} />
                </label>
              )}
              <div className="sm:col-span-2">
                <button type="submit" className={btnCls} disabled={adding}>
                  {adding ? "Adding…" : "Add consumable"}
                </button>
                <Feedback state={state} />
              </div>
            </form>
          </AddPanel>
        </div>
      )}
    </section>
  );
}

function ExternalCosts({ fin, onChanged }: { fin: LeadFinancials; onChanged?: () => void }) {
  const [state, add, adding] = useActionState(addExternalCostAction, IDLE);
  useNotifyChanged(state, onChanged);

  return (
    <section>
      <SectionLabel>External costs</SectionLabel>
      {fin.externalCosts.length === 0 ? (
        <p className="text-[12px] text-ink-400">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {fin.externalCosts.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between rounded-md border border-line-softer px-3 py-2 text-[12px]"
            >
              <span className="text-ink-900">
                <Badge className="mr-2 bg-line-faint text-ink-600">{CATEGORY_LABEL[e.category]}</Badge>
                {e.description}
                {e.vendor && <span className="text-ink-400"> — {e.vendor}</span>}
              </span>
              <span className="flex items-center font-semibold tabular-nums text-ink-900">
                {formatMoney(e.amount, fin.currency)}
                {fin.canEditRules && <LineControls type="external_cost" id={e.id} amount={e.amount} description={e.description} occurredOn={e.occurredOn} onChanged={onChanged}/>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {fin.canEditRules && (
        <div className="mt-2">
          <AddPanel label="Add external cost">
            <form action={add} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="leadId" value={fin.leadId} />
              <label className="text-[11px] text-ink-500">
                Category
                <select name="category" className={cn(inputCls, "mt-1")} defaultValue="lab">
                  {Object.entries(CATEGORY_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-[11px] text-ink-500">
                Amount
                <input name="amount" type="number" min="0.01" step="0.01" required className={cn(inputCls, "mt-1 tabular-nums")} />
              </label>
              <label className="text-[11px] text-ink-500">
                Description
                <input name="description" required className={cn(inputCls, "mt-1")} />
              </label>
              <label className="text-[11px] text-ink-500">
                Payee
                <input name="vendor" className={cn(inputCls, "mt-1")} />
              </label>
              <label className="text-[11px] text-ink-500">
                Date
                <input name="occurredOn" type="date" className={cn(inputCls, "mt-1")} />
              </label>
              <label className="text-[11px] text-ink-500">
                Receipt / reference
                <input name="reference" className={cn(inputCls, "mt-1")} />
              </label>
              <label className="text-[11px] text-ink-500 sm:col-span-2">
                Notes
                <input name="notes" className={cn(inputCls, "mt-1")} />
              </label>
              <div className="sm:col-span-2">
                <button type="submit" className={btnCls} disabled={adding}>
                  {adding ? "Adding…" : "Add cost"}
                </button>
                <Feedback state={state} />
              </div>
            </form>
          </AddPanel>
        </div>
      )}
    </section>
  );
}

function Doctors({ fin, onChanged }: { fin: LeadFinancials; onChanged?: () => void }) {
  const [state, add, adding] = useActionState(addDoctorFundedAction, IDLE);
  useNotifyChanged(state, onChanged);

  return (
    <section>
      <SectionLabel>Doctors</SectionLabel>

      <div className="rounded-lg border border-line-soft bg-panel p-3">
        <div className="text-[11px] font-semibold text-ink-600">Compensation owed</div>
        {fin.doctorCompensations.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink-400">No compensation rules on this lead.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {fin.doctorCompensations.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-900">
                  {d.doctorName ?? d.doctorId}
                  <span className="text-ink-400">
                    {" "}
                    — {d.kind === "fixed" ? formatMoney(d.value, fin.currency) : `${formatPct(d.value)} of ${
                      d.basis === "net_after_consumables" ? "revenue after consumables" : "quoted price"
                    }`}
                  </span>
                </span>
                <span className="font-semibold tabular-nums text-ink-900">
                  {formatMoney(d.computedAmount, fin.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 rounded-lg border border-line-soft bg-panel p-3">
        <div className="text-[11px] font-semibold text-ink-600">Paid by doctor</div>
        <p className="mt-0.5 text-[11px] text-ink-400">
          Money a doctor put toward this patient&apos;s bill. Separate from compensation owed to them.
        </p>
        {fin.doctorFunded.length === 0 ? (
          <p className="mt-1 text-[12px] text-ink-400">None recorded.</p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {fin.doctorFunded.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-[12px]">
                <span className="text-ink-900">
                  {d.doctorName ?? d.doctorId}
                  <span className="text-ink-400"> — {formatDate(d.occurredOn)}</span>
                  {!d.reducesPatientBalance && (
                    <Badge className="ml-2 bg-line-faint text-ink-500">Does not reduce balance</Badge>
                  )}
                </span>
                <span className="flex items-center font-semibold tabular-nums text-ink-900">
                  {formatMoney(d.amount, fin.currency)}
                  {fin.canEditRules && <LineControls type="doctor_payment" id={d.id} amount={d.amount} occurredOn={d.occurredOn} onChanged={onChanged}/>}
                </span>
              </li>
            ))}
          </ul>
        )}

        {fin.canEditRules && (
          <div className="mt-2">
            <AddPanel label="Add doctor payment">
              <form action={add} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="leadId" value={fin.leadId} />
                <label className="text-[11px] text-ink-500">
                  Doctor
                  <select
                    name="doctorId"
                    required
                    className={cn(inputCls, "mt-1")}
                    disabled={fin.doctorOptions.length === 0}
                  >
                    <option value="">Select doctor...</option>
                    {fin.doctorOptions.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                        {doctor.active ? "" : " (inactive)"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-[11px] text-ink-500">
                  Amount
                  <input name="amount" type="number" min="0.01" step="0.01" required className={cn(inputCls, "mt-1 tabular-nums")} />
                </label>
                <label className="text-[11px] text-ink-500">
                  Date
                  <input name="occurredOn" type="date" className={cn(inputCls, "mt-1")} />
                </label>
                <label className="text-[11px] text-ink-500">
                  Reference
                  <input name="reference" className={cn(inputCls, "mt-1")} />
                </label>
                <label className="text-[11px] text-ink-500">
                  Notes
                  <input name="note" className={cn(inputCls, "mt-1")} />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-ink-500 sm:col-span-2">
                  <input type="checkbox" name="reducesPatientBalance" value="true" defaultChecked />
                  This reduces the patient&apos;s outstanding balance
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" className={btnCls} disabled={adding || fin.doctorOptions.length === 0}>
                    {adding ? "Recording…" : "Record doctor payment"}
                  </button>
                  {fin.doctorOptions.length === 0 && (
                    <p className="mt-2 text-[11px] text-warn">
                      Admin doctor catalog is not configured or has no doctors.
                    </p>
                  )}
                  <Feedback state={state} />
                </div>
              </form>
            </AddPanel>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── audit ────────────────────────────────────────────────────── */

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function AuditTrail({ fin }: { fin: LeadFinancials }) {
  if (fin.auditTrail.length === 0) return null;
  return (
    <section>
      <SectionLabel>Financial history</SectionLabel>
      <ul className="flex flex-col gap-1">
        {fin.auditTrail.map((a) => (
          <li key={a.id} className="rounded-md border border-line-softer px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink-900">
                {a.action.replace(/_/g, " ")} · {a.entityType.replace(/_/g, " ")}
              </span>
              <span className="text-ink-400">{formatDateTime(a.createdAt)}</span>
            </div>
            <div className="mt-0.5 text-ink-500">
              {a.actorName}
              {a.actorRole ? ` (${a.actorRole})` : ""}
              {a.field ? ` changed ${a.field} from ${fmtValue(a.oldValue)} to ${fmtValue(a.newValue)}` : ""}
              {a.reason ? ` — "${a.reason}"` : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── tab ──────────────────────────────────────────────────────── */

/**
 * The lead's Payments/Financials tab.
 *
 * `financials` is `null` only when the financial tables could not be read (see
 * `loadLeadDetail`) — the rest of the drawer must keep working, so we say so
 * plainly instead of rendering zeros that look like real money.
 */
export function PaymentsTab({
  financials,
  error,
  onChanged,
}: {
  financials: LeadFinancials | null;
  error?: string | null;
  onChanged?: () => void;
}) {
  if (!financials) {
    return (
      <EmptyState
        icon="!"
        title="Financial records are unavailable"
        hint={error ? `Supabase rejected the financial read: ${error}` : "No financial record is available for this lead yet."}
      />
    );
  }

  const fin = financials;
  const s = fin.summary;
  const cur = fin.currency;

  return (
    <div className="flex flex-col gap-4 bg-toolbar/30 p-3 sm:p-5 [&>section]:rounded-xl [&>section]:border [&>section]:border-line-soft [&>section]:bg-panel [&>section]:p-4 [&>section]:shadow-sm">
      <section className="!border-ink-900 !bg-ink-900 !p-5 text-white">
        <div className="grid gap-5 sm:grid-cols-[1.25fr_1fr] sm:items-end">
          <div>
            <div className="text-[10.5px] font-black uppercase tracking-[0.16em] text-white/55">Patient balance</div>
            <div className={"mt-2 text-[30px] font-black tabular-nums sm:text-[36px] " + (s.outstanding > 0 ? "text-white" : "text-emerald-300")}>
              {formatMoney(s.outstanding, cur)}
            </div>
            <div className="mt-2 text-[12px] text-white/65">
              {s.outstanding > 0 ? "Still due from the patient" : "Account is settled"}
              {s.pendingTotal > 0 ? ` · ${formatMoney(s.pendingTotal, cur)} pending settlement` : ""}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-white/15 pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
            <div><div className="text-[10px] uppercase text-white/45">Agreed price</div><div className="mt-1 text-[15px] font-bold">{s.hasQuote ? formatMoney(s.quotedPrice, cur) : "Not set"}</div></div>
            <div><div className="text-[10px] uppercase text-white/45">Collected</div><div className="mt-1 text-[15px] font-bold text-emerald-300">{formatMoney(s.totalCollected, cur)}</div></div>
            <div><div className="text-[10px] uppercase text-white/45">Discount</div><div className="mt-1 text-[15px] font-bold">{formatPct(s.effectiveDiscountPct)}</div></div>
            <div><div className="text-[10px] uppercase text-white/45">Amount due</div><div className="mt-1 text-[15px] font-bold">{formatMoney(s.amountDue, cur)}</div></div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-line bg-panel text-center text-[10.5px] font-bold text-ink-500">
        <div className="border-r border-line px-2 py-2.5"><span className="mr-1 text-primary">1</span> Set price</div>
        <div className="border-r border-line px-2 py-2.5"><span className="mr-1 text-primary">2</span> Record payment</div>
        <div className="px-2 py-2.5"><span className="mr-1 text-primary">3</span> Verify balance</div>
      </div>

      <QuoteEditor fin={fin} onChanged={onChanged} />

      <section className="border-l-4 border-l-amber-500">
        <SectionLabel>How installments work</SectionLabel>
        <ol className="grid gap-2 text-[12px] text-ink-700 md:grid-cols-3">
          <li className="bg-amber-50 p-3"><strong className="block text-amber-800">1. Confirm the quote</strong>Save the full agreed service price first. Do not reduce the quote to the amount being paid today.</li>
          <li className="bg-blue-50 p-3"><strong className="block text-blue-800">2. Record today&apos;s payment</strong>Add only the amount actually received, with its real method, date, and receipt reference.</li>
          <li className="bg-emerald-50 p-3"><strong className="block text-emerald-800">3. Verify the balance</strong>The remaining amount stays in Outstanding Balance. Record each later installment as a new transaction.</li>
        </ol>
      </section>

      {fin.bundleItems.length > 0 && (
        <section>
          <SectionLabel>Bundle</SectionLabel>
          <ul className="flex flex-col gap-1">
            {fin.bundleItems.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-md border border-line-softer px-3 py-2 text-[12px]"
              >
                <span className="text-ink-900">{b.serviceName}</span>
                <span className="tabular-nums text-ink-500">{formatMoney(b.basePrice, cur)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-ink-400">
            These are the services in the bundle. The bill is the quoted price above, not their sum.
          </p>
        </section>
      )}

      <Approvals fin={fin} onChanged={onChanged} />
      <PaymentsLedger fin={fin} onChanged={onChanged} />
      {fin.canEditRules && (
        <>
          <Consumables fin={fin} onChanged={onChanged} />
          <Doctors fin={fin} onChanged={onChanged} />
          <ExternalCosts fin={fin} onChanged={onChanged} />
        </>
      )}

      {fin.canEditRules && (
        <section>
          <SectionLabel>Profitability</SectionLabel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Recognized revenue" value={formatMoney(s.quotedPrice, cur)} />
            <Stat label="Consumables" value={formatMoney(s.consumablesTotal, cur)} />
            <Stat label="Doctor compensation" value={formatMoney(s.doctorCompensationTotal, cur)} />
            <Stat label="External costs" value={formatMoney(s.externalCostsTotal, cur)} />
            <Stat
              label="Net profit"
              value={formatMoney(s.netProfit, cur)}
              tone={s.netProfit < 0 ? "danger" : "success"}
            />
          </div>
        </section>
      )}

      <AuditTrail fin={fin} />
    </div>
  );
}
