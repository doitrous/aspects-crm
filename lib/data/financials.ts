import "server-only";
import type { SessionUser } from "@/lib/auth/account";
import { assertCan, can } from "@/lib/auth/permissions";
import { ActorError, writeActor } from "@/lib/data/actor";
import { requireSession } from "@/lib/data/session";
import {
  computeFinancials,
  type FinancialSummary,
  type TransactionKind,
  type TransactionStatus,
} from "@/lib/financial/engine";
import { addMoney, roundMoney } from "@/lib/financial/money";
import { serviceBillTotal } from "@/lib/financial/serviceLines";
import { evaluateQuote, type QuoteEvaluation } from "@/lib/financial/quote";
import {
  isEffective,
  resolveMaxDiscount,
  serviceKey,
  type DiscountRule,
  type DiscountScope,
} from "@/lib/financial/rules";
import { supabaseAdmin } from "@/lib/supabase/server";
import { financialDoctorCatalog } from "@/lib/booking/service";

/**
 * The lead-level financial source of truth (financial spec §1).
 *
 * Every derived figure on the Payments tab, the Admin/Auditor dashboards and the
 * financial reports comes from here, and every number here comes from
 * {@link computeFinancials}. Nothing re-derives a total inline, and no total
 * submitted by the browser is ever trusted: the server re-resolves the discount
 * rule and re-runs the engine before it writes.
 *
 * Storage notes:
 *  - `crm_financial_transactions` is APPEND-ONLY for money. A refund/reversal is
 *    a new row pointing at the original; originals are never deleted. The only
 *    permitted update is a `status` transition (pending → completed/failed/…).
 *  - "Payment by doctor" lives in `crm_doctor_funded_payments`, not the ledger,
 *    because it must carry the doctor. Rows flagged `reduces_patient_balance`
 *    are fed to the engine as `doctor_funded` inputs — derived, never duplicated.
 *  - `base_service_price` is frozen on the record at creation (§2): re-pricing a
 *    service later must never restate a historical patient's bill.
 *
 * REQUIRES migration `0007_payment_lines_and_bundles.sql`.
 */

export class FinancialError extends Error {}

/* ── row shapes ───────────────────────────────────────────────── */

/**
 * A lead is addressed two ways: `lead_id` is the human "L0001" the URL carries,
 * `id` is the uuid every financial foreign key points at. Resolve once, then use
 * `id` for all writes — mixing them silently writes orphan rows.
 */
interface LeadRow {
  /** uuid — `leads.id`, the FK target for every financial table. */
  id: string;
  /** human id — `leads.lead_id`, what routes and forms carry. */
  lead_id: string;
  service_name: string | null;
  booking_service_id: string | null;
  coordinator_user_id: string | null;
  doctor_id: string | null;
  initial_price: number | null;
  metadata: Record<string, unknown> | null;
}

interface RecordRow {
  id: string;
  lead_id: string;
  service_settings_id: string | null;
  service_name: string | null;
  base_service_price: number;
  quoted_price: number | null;
  max_allowed_discount_pct: number;
  is_exceptional: boolean;
  exceptional_reason: string | null;
  exceptional_by: string | null;
  exceptional_at: string | null;
  service_date: string | null;
  currency: string;
  financial_notes: string | null;
}

const RECORD_COLS =
  "id, lead_id, service_settings_id, service_name, base_service_price, quoted_price, " +
  "max_allowed_discount_pct, is_exceptional, exceptional_reason, exceptional_by, " +
  "exceptional_at, service_date, currency, financial_notes";

/* ── view models ──────────────────────────────────────────────── */

export type PaymentMethod =
  | "cash"
  | "visa"
  | "instapay"
  | "mobile_wallet"
  | "bank_transfer"
  | "other";

export interface PaymentLine {
  id: string;
  kind: TransactionKind;
  amount: number;
  method: PaymentMethod | null;
  status: TransactionStatus;
  occurredOn: string;
  reference: string | null;
  receiptNumber: string | null;
  note: string | null;
  reversesTransactionId: string | null;
  enteredByName: string;
  createdAt: string;
}

export interface ConsumableLine {
  id: string;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  isOverride: boolean;
  overrideReason: string | null;
}

export interface DoctorCompLine {
  id: string;
  doctorId: string;
  doctorName: string | null;
  kind: "percentage" | "fixed";
  value: number;
  basis: "quoted_price" | "net_after_consumables";
  computedAmount: number;
}

export interface DoctorFundedLine {
  id: string;
  doctorId: string;
  doctorName: string | null;
  amount: number;
  occurredOn: string;
  note: string | null;
  reference: string | null;
  reducesPatientBalance: boolean;
}

export interface FinancialDoctorOption {
  id: string;
  name: string;
  photoUrl: string | null;
  active: boolean;
}

export type ExternalCostCategory =
  | "lab"
  | "outside_facility"
  | "external_surgeon"
  | "anesthetist"
  | "imaging"
  | "referral_commission"
  | "external_provider"
  | "other";

export interface ExternalCostLine {
  id: string;
  category: ExternalCostCategory;
  description: string;
  amount: number;
  vendor: string | null;
  occurredOn: string;
  notes: string | null;
  reference: string | null;
}

export interface BundleItem {
  id: string;
  serviceSettingsId: string | null;
  serviceId: string | null;
  serviceName: string;
  listPrice: number;
  billPrice: number;
  sourceKind: "service" | "bundle" | "addon";
  sourceLabel: string | null;
}

export interface AvailableBundle {
  id: string;
  name: string;
  price: number;
  currency: string;
  serviceNames: string[];
}

export interface UnlockedAddon {
  id: string;
  triggerServiceName: string;
  addonServiceName: string;
  addonPrice: number;
  redeemWithinDays: number;
}

export interface FinancialServiceOption {
  id: string;
  serviceId: string | null;
  name: string;
  basePrice: number;
}

export interface ApprovalRequest {
  id: string;
  status: "pending" | "approved" | "rejected" | "resolved";
  basePrice: number;
  requestedQuotedPrice: number;
  approvedQuotedPrice: number | null;
  maxAllowedPct: number;
  requestedPct: number;
  reason: string | null;
  requestedByName: string;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
  escalationId: string | null;
}

export interface AuditEntry {
  id: string;
  entityType: string;
  action: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  actorName: string;
  actorRole: string | null;
  reason: string | null;
  createdAt: string;
}

/** Everything the Payments/Financials tab renders, for one lead. */
export interface LeadFinancials {
  leadId: string;
  /** `null` until the first financial write creates the record. */
  recordId: string | null;
  serviceName: string | null;
  currency: string;
  serviceDate: string | null;
  financialNotes: string | null;

  isExceptional: boolean;
  exceptionalReason: string | null;
  exceptionalByName: string | null;
  exceptionalAt: string | null;

  summary: FinancialSummary;
  quote: QuoteEvaluation;
  /** Which discount-rule scope decided the ceiling, for the "why" tooltip. */
  discountRuleScope: DiscountScope | null;

  payments: PaymentLine[];
  consumables: ConsumableLine[];
  doctorCompensations: DoctorCompLine[];
  doctorFunded: DoctorFundedLine[];
  externalCosts: ExternalCostLine[];
  bundleItems: BundleItem[];
  availableBundles: AvailableBundle[];
  unlockedAddons: UnlockedAddon[];
  serviceOptions: FinancialServiceOption[];
  approvals: ApprovalRequest[];
  auditTrail: AuditEntry[];
  doctorOptions: FinancialDoctorOption[];

  /** Capability flags for the viewer, so the UI never offers a refused action. */
  canEdit: boolean;
  canForce: boolean;
  canApprove: boolean;
  canEditRules: boolean;
}

/* ── helpers ──────────────────────────────────────────────────── */

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0);
const today = (): string => new Date().toISOString().slice(0, 10);
const leadSpecialtyId = (lead: LeadRow): string | null => typeof lead.metadata?.specialty_id === "string" ? lead.metadata.specialty_id : null;
function addonWithinRedemptionWindow(serviceDate: string | null, redeemWithinDays: number): boolean {
  if (!serviceDate) return true;
  const expiry = new Date(`${serviceDate}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return true;
  expiry.setUTCDate(expiry.getUTCDate() + Math.max(0, Math.trunc(redeemWithinDays)));
  return Date.now() <= expiry.getTime();
}

/** Resolve `crm_users.id` → display name for a set of ids, in one round trip. */
async function nameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data } = await supabaseAdmin()
    .from("crm_users")
    .select("id, full_name, email")
    .in("id", unique)
    .returns<{ id: string; full_name: string | null; email: string | null }[]>();
  for (const u of data ?? []) {
    names.set(u.id, u.full_name?.trim() || u.email || "Unknown");
  }
  return names;
}

async function financialDoctorOptions(): Promise<FinancialDoctorOption[]> {
  const catalog = await financialDoctorCatalog();
  return catalog.doctors.map((doctor) => ({
    id: doctor.id,
    name: doctor.nameEn || doctor.nameAr || doctor.id,
    photoUrl: doctor.photoUrl ?? null,
    active: doctor.active,
  }));
}

async function financialServiceOptions(): Promise<FinancialServiceOption[]> {
  const { data, error } = await supabaseAdmin().from("crm_financial_service_settings")
    .select("id,service_id,service_name,base_price").eq("active", true).order("service_name");
  if (error) throw new FinancialError(`Could not load financial services: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id as string, serviceId: (row.service_id as string | null) ?? null, name: row.service_name as string, basePrice: num(row.base_price) }));
}

async function loadOfferOptions(existing: Array<{ serviceId: string | null; serviceName: string }>, specialtyId: string | null): Promise<{ bundles: AvailableBundle[]; addons: UnlockedAddon[] }> {
  const db = supabaseAdmin();
  const [offers, components, rules] = await Promise.all([
    db.from("crm_financial_bundles").select("id,name,price,currency,specialty_id,starts_on,expires_on").eq("active", true),
    db.from("crm_financial_bundle_components").select("bundle_id,service_name").order("display_order"),
    db.from("crm_service_addon_rules").select("id,trigger_service_id,trigger_service_name,addon_service_name,addon_price,redeem_within_days").eq("active", true),
  ]);
  const day = today();
  return {
    bundles: ((offers.data ?? []) as Array<{ id: string; name: string; price: number; currency: string; specialty_id: string | null; starts_on: string | null; expires_on: string | null }>)
      .filter((offer) => (!offer.specialty_id || offer.specialty_id === specialtyId) && (!offer.starts_on || offer.starts_on <= day) && (!offer.expires_on || offer.expires_on >= day))
      .map((offer) => ({
        id: offer.id,
        name: offer.name,
        price: num(offer.price),
        currency: offer.currency,
        serviceNames: ((components.data ?? []) as Array<{ bundle_id: string; service_name: string }>).filter((component) => component.bundle_id === offer.id).map((component) => component.service_name),
      })),
    addons: ((rules.data ?? []) as Array<{ id: string; trigger_service_id: string | null; trigger_service_name: string; addon_service_name: string; addon_price: number; redeem_within_days: number }>)
      .filter((rule) => existing.some((item) => item.serviceId === rule.trigger_service_id || item.serviceName.toLowerCase() === rule.trigger_service_name.toLowerCase()))
      .map((rule) => ({ id: rule.id, triggerServiceName: rule.trigger_service_name, addonServiceName: rule.addon_service_name, addonPrice: num(rule.addon_price), redeemWithinDays: num(rule.redeem_within_days) })),
  };
}

/** Look a lead up by the human id the route carries (`L0001`), never by uuid. */
async function leadRow(humanId: string): Promise<LeadRow> {
  const { data } = await supabaseAdmin()
    .from("leads")
    .select("id, lead_id, service_name, booking_service_id, coordinator_user_id, doctor_id, initial_price, metadata")
    .eq("lead_id", humanId)
    .is("deleted_at", null)
    .maybeSingle<LeadRow>();
  if (!data) throw new FinancialError("That lead no longer exists.");
  return data;
}

/**
 * The max discount allowed for this lead right now, by the §4 precedence:
 * moderator+service → moderator → service → global default.
 *
 * Re-resolved on every quote write rather than read from the stored column, so a
 * rule change takes effect immediately. The value that was in force when a quote
 * was accepted is then frozen onto the record for the auditor.
 */
async function resolveCeiling(
  lead: LeadRow,
  onDate: string,
  moderatorId: string | null,
): Promise<{ maxPct: number; scope: DiscountScope | null }> {
  const { data } = await supabaseAdmin()
    .from("crm_discount_rules")
    .select("scope, moderator_id, service_id, service_name, max_discount_pct, effective_from, effective_to")
    .eq("active", true)
    .returns<
      {
        scope: DiscountScope;
        moderator_id: string | null;
        service_id: string | null;
        service_name: string | null;
        max_discount_pct: number;
        effective_from: string | null;
        effective_to: string | null;
      }[]
    >();

  const rules: DiscountRule[] = (data ?? [])
    .filter((r) => isEffective({ effectiveFrom: r.effective_from, effectiveTo: r.effective_to }, onDate))
    .map((r) => ({
      scope: r.scope,
      moderatorId: r.moderator_id,
      serviceId: serviceKey(r.service_id, r.service_name),
      maxDiscountPct: num(r.max_discount_pct),
    }));

  const resolved = resolveMaxDiscount(rules, {
    moderatorId,
    serviceId: serviceKey(lead.booking_service_id, lead.service_name),
  });
  return { maxPct: resolved.maxDiscountPct, scope: resolved.rule?.scope ?? null };
}

/**
 * The frozen list price for a lead that has no financial record yet.
 *
 * Read from CRM service settings — deliberately NOT from the public booking
 * website's price (§2: CRM pricing is independent). Falls back to the lead's
 * captured `initial_price`, then to `0`.
 */
async function lookupBasePrice(
  lead: LeadRow,
): Promise<{ basePrice: number; settingsId: string | null; consumablesDefault: number }> {
  const key = serviceKey(lead.booking_service_id, lead.service_name);
  if (key) {
    const q = supabaseAdmin()
      .from("crm_financial_service_settings")
      .select("id, base_price, default_consumables_cost")
      .eq("active", true);
    const { data } = await (lead.booking_service_id
      ? q.eq("service_id", lead.booking_service_id)
      : q.ilike("service_name", lead.service_name ?? "")
    ).maybeSingle<{ id: string; base_price: number; default_consumables_cost: number }>();

    if (data) {
      return {
        basePrice: num(data.base_price),
        settingsId: data.id,
        consumablesDefault: num(data.default_consumables_cost),
      };
    }
  }
  return { basePrice: num(lead.initial_price), settingsId: null, consumablesDefault: 0 };
}

/* ── audit (§14) ──────────────────────────────────────────────── */

interface AuditInput {
  entityType: string;
  entityId: string | null;
  action: string;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/**
 * Append to `crm_financial_audit_log`. Every financial mutation calls this with
 * what changed, the old value, the new value, who, their role and why.
 *
 * A failure here fails the caller: a change that could not be audited must not
 * be reported as successful.
 */
async function audit(actor: SessionUser, entry: AuditInput): Promise<void> {
  const { error } = await supabaseAdmin().from("crm_financial_audit_log").insert({
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    action: entry.action,
    field: entry.field ?? null,
    old_value: entry.oldValue === undefined ? null : entry.oldValue,
    new_value: entry.newValue === undefined ? null : entry.newValue,
    actor_user_id: actor.id,
    actor_role: actor.role,
    reason: entry.reason?.trim() || null,
  });
  if (error) throw new FinancialError(`Could not write the audit record: ${error.message}`);
}

async function leadLog(
  actor: SessionUser,
  params: {
    leadUid: string;
    action: string;
    title: string;
    body?: string | null;
    field?: string;
    oldValue?: unknown;
    newValue?: unknown;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const oldValues = params.oldValue === undefined ? {} : { [params.field ?? "value"]: params.oldValue };
  const newValues = params.newValue === undefined ? {} : { [params.field ?? "value"]: params.newValue };
  const metadata = { ...(params.metadata ?? {}), actor_name: actor.name };
  const db = supabaseAdmin();
  const [auditResult, timelineResult] = await Promise.all([
    db.from("audit_logs").insert({
      actor_user_id: actor.id,
      action: params.action,
      entity_type: "lead",
      entity_id: params.leadUid,
      old_values: oldValues,
      new_values: newValues,
      metadata,
    }),
    db.from("lead_timeline_events").insert({
      lead_id: params.leadUid,
      event_type: "payment_changed",
      title: params.title,
      body: params.body ?? null,
      actor_user_id: actor.id,
      metadata: { ...metadata, action: params.action, old_values: oldValues, new_values: newValues },
    }),
  ]);
  if (auditResult.error) throw new FinancialError(`Could not write the lead audit record: ${auditResult.error.message}`);
  if (timelineResult.error) throw new FinancialError(`Could not write the lead payment log: ${timelineResult.error.message}`);
}

/* ── read ─────────────────────────────────────────────────────── */

/** @param leadUid `leads.id` (uuid), not the human `L0001`. */
async function fetchRecord(leadUid: string): Promise<RecordRow | null> {
  const { data } = await supabaseAdmin()
    .from("crm_lead_financials")
    .select(RECORD_COLS)
    .eq("lead_id", leadUid)
    .maybeSingle<RecordRow>();
  return data ?? null;
}

/**
 * Load the full financial picture for one lead.
 *
 * Safe to call for a lead that has never been priced: the record is not created
 * as a side effect of viewing, so read-only roles never write. Everything simply
 * reads as empty against the frozen base price.
 */
export async function leadFinancials(leadId: string): Promise<LeadFinancials> {
  const { effective: viewer } = await requireSession();
  assertCan(viewer.role, "financial.view");

  const lead = await leadRow(leadId);
  const record = await fetchRecord(lead.id);
  const onDate = record?.service_date ?? today();
  const ceiling = await resolveCeiling(lead, onDate, viewer.id);
  const canEdit = can(viewer.role, "financial.editLeadRecord");
  const canForce = can(viewer.role, "financial.forceExceptionalPrice");
  const canEditRules = can(viewer.role, "financial.editRules");
  const doctorOptions = canEditRules ? await financialDoctorOptions() : [];
  const serviceOptions = await financialServiceOptions();

  if (!record) {
    const offerOptions = await loadOfferOptions([], leadSpecialtyId(lead));
    const { basePrice } = await lookupBasePrice(lead);
    const summary = computeFinancials({
      baseServicePrice: basePrice,
      quotedPrice: null,
      maxAllowedDiscountPct: ceiling.maxPct,
    });
    return {
      leadId,
      recordId: null,
      serviceName: lead.service_name,
      currency: "EGP",
      serviceDate: null,
      financialNotes: null,
      isExceptional: false,
      exceptionalReason: null,
      exceptionalByName: null,
      exceptionalAt: null,
      summary,
      quote: evaluateQuote({
        baseServicePrice: basePrice,
        quotedPrice: null,
        maxAllowedDiscountPct: ceiling.maxPct,
        viewerCanForce: canForce,
      }),
      discountRuleScope: ceiling.scope,
      payments: [],
      consumables: [],
      doctorCompensations: [],
      doctorFunded: [],
      externalCosts: [],
      bundleItems: [],
      availableBundles: offerOptions.bundles,
      unlockedAddons: offerOptions.addons,
      serviceOptions,
      approvals: [],
      auditTrail: [],
      doctorOptions,
      canEdit,
      canForce,
      canApprove: can(viewer.role, "financial.approveDiscount"),
      canEditRules,
    };
  }

  const db = supabaseAdmin();
  const [txns, consumables, comps, funded, external, bundle, offers, offerComponents, addonRules, approvals, auditRows] =
    await Promise.all([
      db
        .from("crm_financial_transactions")
        .select(
          "id, kind, amount, method, status, occurred_on, reference, receipt_number, note, reverses_transaction_id, created_by, created_at",
        )
        .eq("lead_financials_id", record.id)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }),
      db
        .from("crm_lead_consumables")
        .select("id, description, quantity, unit_cost, total_cost, is_override, override_reason")
        .eq("lead_financials_id", record.id)
        .order("created_at", { ascending: true }),
      db
        .from("crm_lead_doctor_compensation")
        .select("id, doctor_id, doctor_name, kind, value, basis, computed_amount")
        .eq("lead_financials_id", record.id)
        .order("created_at", { ascending: true }),
      db
        .from("crm_doctor_funded_payments")
        .select("id, doctor_id, doctor_name, amount, occurred_on, note, reference, reduces_patient_balance")
        .eq("lead_financials_id", record.id)
        .order("occurred_on", { ascending: false }),
      db
        .from("crm_external_costs")
        .select("id, category, description, amount, vendor, occurred_on, notes, reference")
        .eq("lead_financials_id", record.id)
        .order("occurred_on", { ascending: false }),
      db
        .from("crm_lead_bundle_items")
        .select("id, service_settings_id, service_id, service_name, list_price, base_price, source_kind, source_rule_id, source_label")
        .eq("lead_financials_id", record.id)
        .order("created_at", { ascending: true }),
      db.from("crm_financial_bundles")
        .select("id,name,price,currency,specialty_id,starts_on,expires_on")
        .eq("active", true),
      db.from("crm_financial_bundle_components")
        .select("bundle_id,service_name")
        .order("display_order", { ascending: true }),
      db.from("crm_service_addon_rules")
        .select("id,trigger_service_id,trigger_service_name,addon_service_id,addon_service_name,addon_price,redeem_within_days")
        .eq("active", true),
      db
        .from("crm_discount_approvals")
        .select(
          "id, status, base_service_price, requested_quoted_price, approved_quoted_price, max_allowed_pct, requested_pct, reason, requested_by, decided_by, decided_at, created_at, escalation_id",
        )
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: false }),
      db
        .from("crm_financial_audit_log")
        .select("id, entity_type, entity_id, action, field, old_value, new_value, actor_user_id, actor_role, reason, created_at")
        .in("entity_type", ["lead_financials", "financial_transaction", "lead_consumable", "external_cost", "doctor_funded_payment", "lead_doctor_compensation", "lead_bundle_item", "discount_approval"])
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

  type TxnRow = {
    id: string;
    kind: TransactionKind;
    amount: number;
    method: PaymentMethod | null;
    status: TransactionStatus;
    occurred_on: string;
    reference: string | null;
    receipt_number: string | null;
    note: string | null;
    reverses_transaction_id: string | null;
    created_by: string | null;
    created_at: string;
  };
  const txnRows = (txns.data ?? []) as TxnRow[];
  const fundedRows = (funded.data ?? []) as {
    id: string;
    doctor_id: string;
    doctor_name: string | null;
    amount: number;
    occurred_on: string;
    note: string | null;
    reference: string | null;
    reduces_patient_balance: boolean;
  }[];
  type CompRow = {
    id: string;
    doctor_id: string;
    doctor_name: string | null;
    kind: "percentage" | "fixed";
    value: number;
    basis: "quoted_price" | "net_after_consumables";
    computed_amount: number;
  };
  const compRows = (comps.data ?? []) as CompRow[];
  const auditList = (auditRows.data ?? []) as {
    id: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    field: string | null;
    old_value: unknown;
    new_value: unknown;
    actor_user_id: string | null;
    actor_role: string | null;
    reason: string | null;
    created_at: string;
  }[];
  const approvalRows = (approvals.data ?? []) as {
    id: string;
    status: ApprovalRequest["status"];
    base_service_price: number;
    requested_quoted_price: number;
    approved_quoted_price: number | null;
    max_allowed_pct: number;
    requested_pct: number;
    reason: string | null;
    requested_by: string | null;
    decided_by: string | null;
    decided_at: string | null;
    created_at: string;
    escalation_id: string | null;
  }[];

  // Only audit rows that belong to THIS lead's financial graph.
  const ownedIds = new Set<string>([
    record.id,
    ...txnRows.map((t) => t.id),
    ...fundedRows.map((f) => f.id),
    ...(consumables.data ?? []).map((c) => (c as { id: string }).id),
    ...(external.data ?? []).map((e) => (e as { id: string }).id),
    ...compRows.map((c) => c.id),
    ...(bundle.data ?? []).map((item) => (item as { id: string }).id),
    ...approvalRows.map((a) => a.id),
  ]);
  const ownedAudit = auditList.filter((a) => a.entity_id && ownedIds.has(a.entity_id));

  const names = await nameMap([
    record.exceptional_by,
    ...txnRows.map((t) => t.created_by),
    ...ownedAudit.map((a) => a.actor_user_id),
    ...approvalRows.map((a) => a.requested_by),
    ...approvalRows.map((a) => a.decided_by),
  ]);

  const consumablesTotal = addMoney(
    ...(consumables.data ?? []).map((c) => num((c as { total_cost: number }).total_cost)),
  );
  const externalCostsTotal = addMoney(
    ...(external.data ?? []).map((e) => num((e as { amount: number }).amount)),
  );

  // "Payment by doctor" reaches the engine only when it settles the patient's
  // bill. Rows that do not reduce the balance are recorded but not collected.
  const doctorFundedInputs = fundedRows
    .filter((f) => f.reduces_patient_balance)
    .map((f) => ({ kind: "doctor_funded" as const, amount: num(f.amount) }));

  const summary = computeFinancials({
    baseServicePrice: num(record.base_service_price),
    quotedPrice: record.quoted_price === null ? null : num(record.quoted_price),
    maxAllowedDiscountPct: ceiling.maxPct,
    transactions: [
      ...txnRows.map((t) => ({ kind: t.kind, amount: num(t.amount), status: t.status })),
      ...doctorFundedInputs,
    ],
    consumablesTotal,
    doctorCompensations: compRows.map((r) => ({
      doctorId: r.doctor_id,
      kind: r.kind,
      value: num(r.value),
      basis: r.basis,
    })),
    externalCostsTotal,
  });

  return {
    leadId,
    recordId: record.id,
    serviceName: record.service_name ?? lead.service_name,
    currency: record.currency,
    serviceDate: record.service_date,
    financialNotes: record.financial_notes,
    isExceptional: record.is_exceptional,
    exceptionalReason: record.exceptional_reason,
    exceptionalByName: record.exceptional_by ? (names.get(record.exceptional_by) ?? "Unknown") : null,
    exceptionalAt: record.exceptional_at,
    summary,
    quote: evaluateQuote({
      baseServicePrice: num(record.base_service_price),
      quotedPrice: record.quoted_price === null ? null : num(record.quoted_price),
      maxAllowedDiscountPct: ceiling.maxPct,
      viewerCanForce: canForce,
    }),
    discountRuleScope: ceiling.scope,
    payments: txnRows.map((t) => ({
      id: t.id,
      kind: t.kind,
      amount: num(t.amount),
      method: t.method,
      status: t.status,
      occurredOn: t.occurred_on,
      reference: t.reference,
      receiptNumber: t.receipt_number,
      note: t.note,
      reversesTransactionId: t.reverses_transaction_id,
      enteredByName: t.created_by ? (names.get(t.created_by) ?? "Unknown") : "System",
      createdAt: t.created_at,
    })),
    consumables: (consumables.data ?? []).map((c) => {
      const r = c as { id: string; description: string; quantity: number; unit_cost: number; total_cost: number; is_override: boolean; override_reason: string | null };
      return {
        id: r.id,
        description: r.description,
        quantity: num(r.quantity),
        unitCost: num(r.unit_cost),
        totalCost: num(r.total_cost),
        isOverride: r.is_override,
        overrideReason: r.override_reason,
      };
    }),
    // The engine returns one result per input, in order, so pair by index — two
    // lines for the same doctor (a bundle where they both operate and assist)
    // are distinct rows with distinct amounts.
    doctorCompensations: compRows.map((r, i) => ({
      id: r.id,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      kind: r.kind,
      value: num(r.value),
      basis: r.basis,
      computedAmount: summary.doctorCompensations[i]?.amount ?? num(r.computed_amount),
    })),
    doctorFunded: fundedRows.map((f) => ({
      id: f.id,
      doctorId: f.doctor_id,
      doctorName: f.doctor_name,
      amount: num(f.amount),
      occurredOn: f.occurred_on,
      note: f.note,
      reference: f.reference,
      reducesPatientBalance: f.reduces_patient_balance,
    })),
    externalCosts: (external.data ?? []).map((e) => {
      const r = e as { id: string; category: ExternalCostCategory; description: string; amount: number; vendor: string | null; occurred_on: string; notes: string | null; reference: string | null };
      return {
        id: r.id,
        category: r.category,
        description: r.description,
        amount: num(r.amount),
        vendor: r.vendor,
        occurredOn: r.occurred_on,
        notes: r.notes,
        reference: r.reference,
      };
    }),
    bundleItems: (bundle.data ?? []).map((b) => {
      const r = b as { id: string; service_settings_id: string | null; service_id: string | null; service_name: string; list_price: number; base_price: number; source_kind: BundleItem["sourceKind"]; source_label: string | null };
      return { id: r.id, serviceSettingsId: r.service_settings_id, serviceId: r.service_id, serviceName: r.service_name, listPrice: num(r.list_price), billPrice: num(r.base_price), sourceKind: r.source_kind, sourceLabel: r.source_label };
    }),
    availableBundles: ((offers.data ?? []) as Array<{ id: string; name: string; price: number; currency: string; specialty_id: string | null; starts_on: string | null; expires_on: string | null }>)
      .filter((offer) => (!offer.specialty_id || offer.specialty_id === leadSpecialtyId(lead)) && (!offer.starts_on || offer.starts_on <= today()) && (!offer.expires_on || offer.expires_on >= today()))
      .filter((offer) => !((bundle.data ?? []) as Array<{ source_kind: string; source_rule_id: string | null }>).some((item) => item.source_kind === "bundle" && item.source_rule_id === offer.id))
      .map((offer) => ({ id: offer.id, name: offer.name, price: num(offer.price), currency: offer.currency, serviceNames: ((offerComponents.data ?? []) as Array<{ bundle_id: string; service_name: string }>).filter((component) => component.bundle_id === offer.id).map((component) => component.service_name) })),
    unlockedAddons: ((addonRules.data ?? []) as Array<{ id: string; trigger_service_id: string | null; trigger_service_name: string; addon_service_name: string; addon_price: number; redeem_within_days: number }>)
      .filter((rule) => ((bundle.data ?? []) as Array<{ service_id: string | null; service_name: string }>).some((item) => (rule.trigger_service_id && item.service_id === rule.trigger_service_id) || item.service_name.toLowerCase() === rule.trigger_service_name.toLowerCase()))
      .filter((rule) => !((bundle.data ?? []) as Array<{ source_kind: string; source_rule_id: string | null }>).some((item) => item.source_kind === "addon" && item.source_rule_id === rule.id))
      .filter((rule) => addonWithinRedemptionWindow(record.service_date, rule.redeem_within_days))
      .map((rule) => ({ id: rule.id, triggerServiceName: rule.trigger_service_name, addonServiceName: rule.addon_service_name, addonPrice: num(rule.addon_price), redeemWithinDays: num(rule.redeem_within_days) })),
    serviceOptions,
    approvals: approvalRows.map((a) => ({
      id: a.id,
      status: a.status,
      basePrice: num(a.base_service_price),
      requestedQuotedPrice: num(a.requested_quoted_price),
      approvedQuotedPrice: a.approved_quoted_price === null ? null : num(a.approved_quoted_price),
      maxAllowedPct: num(a.max_allowed_pct),
      requestedPct: num(a.requested_pct),
      reason: a.reason,
      requestedByName: a.requested_by ? (names.get(a.requested_by) ?? "Unknown") : "Unknown",
      decidedByName: a.decided_by ? (names.get(a.decided_by) ?? "Unknown") : null,
      decidedAt: a.decided_at,
      createdAt: a.created_at,
      escalationId: a.escalation_id,
    })),
    auditTrail: ownedAudit.map((a) => ({
      id: a.id,
      entityType: a.entity_type,
      action: a.action,
      field: a.field,
      oldValue: a.old_value,
      newValue: a.new_value,
      actorName: a.actor_user_id ? (names.get(a.actor_user_id) ?? "Unknown") : "System",
      actorRole: a.actor_role,
      reason: a.reason,
      createdAt: a.created_at,
    })),
    doctorOptions,
    canEdit,
    canForce,
    canApprove: can(viewer.role, "financial.approveDiscount"),
    canEditRules,
  };
}

export async function addServicesToLeadFinancials(leadId: string, serviceSettingIds: string[]): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");
  const lead = await leadRow(leadId);
  const record = await ensureRecord(actor, lead);
  const ids = [...new Set(serviceSettingIds.filter(Boolean))];
  if (!ids.length) throw new FinancialError("Choose at least one service.");
  const db = supabaseAdmin();
  const { data: services, error } = await db.from("crm_financial_service_settings")
    .select("id,service_id,service_name,base_price").in("id", ids).eq("active", true);
  if (error) throw new FinancialError(`Could not load selected services: ${error.message}`);
  if ((services ?? []).length !== ids.length) throw new FinancialError("One or more selected services are unavailable.");
  const { data: existing, error: existingError } = await db.from("crm_lead_bundle_items")
    .select("service_settings_id").eq("lead_financials_id", record.id);
  if (existingError) throw new FinancialError(`Could not inspect existing services: ${existingError.message}`);
  const present = new Set((existing ?? []).map((row) => row.service_settings_id as string));
  const additions = (services ?? []).filter((service) => !present.has(service.id as string));
  if (!additions.length) throw new FinancialError("Those services are already on this bill.");
  const { data: inserted, error: insertError } = await db.from("crm_lead_bundle_items").insert(additions.map((service) => ({
    lead_financials_id: record.id,
    service_settings_id: service.id,
    service_id: service.service_id,
    service_name: service.service_name,
    list_price: service.base_price,
    base_price: service.base_price,
    source_kind: "service",
    created_by: actor.id,
  }))).select("id,service_settings_id,service_name,list_price,base_price");
  if (insertError) throw new FinancialError(`Could not add services: ${insertError.message}`);
  await applyCompensationRules(actor, lead, record.id, (inserted ?? []).map((item) => ({
    id: item.id as string,
    serviceId: ((additions.find((service) => service.id === item.service_settings_id)?.service_id as string | null | undefined) ?? null),
    serviceName: item.service_name as string,
  })));
  const baseTotal = await recalculateServiceTotal(record.id, true);
  for (const item of inserted ?? []) {
    await audit(actor, { entityType: "lead_bundle_item", entityId: item.id as string, action: "service_added", newValue: item });
  }
  await audit(actor, { entityType: "lead_financials", entityId: record.id, action: "services_added", field: "base_service_price", oldValue: record.base_service_price, newValue: baseTotal });
  await leadLog(actor, { leadUid: lead.id, action: "lead.payment_services_added", title: "Services added to bill", oldValue: record.base_service_price, newValue: baseTotal, metadata: { lead_id: lead.lead_id, service_names: additions.map((service) => service.service_name) } });
}

async function recalculateServiceTotal(recordId: string, clearSavedQuote: boolean): Promise<number> {
  const db = supabaseAdmin();
  const { data: allItems, error: sumError } = await db.from("crm_lead_bundle_items").select("base_price").eq("lead_financials_id", recordId);
  if (sumError) throw new FinancialError(`Could not total services: ${sumError.message}`);
  const baseTotal = serviceBillTotal((allItems ?? []).map((item) => ({ billPrice: num(item.base_price) })));
  const patch: Record<string, unknown> = { base_service_price: baseTotal, updated_at: new Date().toISOString() };
  if (clearSavedQuote) Object.assign(patch, { quoted_price: null, is_exceptional: false, exceptional_reason: null, exceptional_by: null, exceptional_at: null });
  const { error } = await db.from("crm_lead_financials").update(patch).eq("id", recordId);
  if (error) throw new FinancialError(`Could not update bill total: ${error.message}`);
  return baseTotal;
}

async function applyCompensationRules(
  actor: SessionUser,
  lead: LeadRow,
  recordId: string,
  items: Array<{ id: string; serviceId: string | null; serviceName: string }>,
): Promise<void> {
  if (!items.length) return;
  const db = supabaseAdmin();
  const { data: assigned } = await db.from("crm_lead_treating_doctors")
    .select("doctor_id,doctor_name").eq("lead_id", lead.id).eq("active", true);
  let doctors = ((assigned ?? []) as Array<{ doctor_id: string; doctor_name: string | null }>);
  if (!doctors.length && lead.doctor_id) {
    const option = (await financialDoctorOptions()).find((doctor) => doctor.id === lead.doctor_id);
    doctors = [{ doctor_id: lead.doctor_id, doctor_name: option?.name ?? null }];
  }
  if (!doctors.length) return;
  const { data: rules, error } = await db.from("crm_doctor_compensation_rules")
    .select("doctor_id,doctor_name,service_id,service_name,kind,value,basis,effective_from,effective_to")
    .in("doctor_id", doctors.map((doctor) => doctor.doctor_id)).eq("active", true);
  if (error) throw new FinancialError(`Could not load doctor compensation rules: ${error.message}`);
  const rows: Array<Record<string, unknown>> = [];
  for (const item of items) {
    for (const doctor of doctors) {
      const candidates = ((rules ?? []) as Array<{ doctor_id: string; doctor_name: string | null; service_id: string | null; service_name: string | null; kind: "percentage" | "fixed"; value: number; basis: "quoted_price" | "net_after_consumables"; effective_from: string | null; effective_to: string | null }>)
        .filter((rule) => rule.doctor_id === doctor.doctor_id && isEffective({ effectiveFrom: rule.effective_from, effectiveTo: rule.effective_to }, today()));
      const rule = candidates.find((candidate) => (candidate.service_id && candidate.service_id === item.serviceId) || candidate.service_name?.toLowerCase() === item.serviceName.toLowerCase())
        ?? candidates.find((candidate) => !candidate.service_id && !candidate.service_name);
      if (!rule) continue;
      rows.push({ lead_financials_id: recordId, bundle_item_id: item.id, doctor_id: doctor.doctor_id, doctor_name: doctor.doctor_name ?? rule.doctor_name, kind: rule.kind, value: rule.value, basis: rule.basis, computed_amount: 0, created_by: actor.id });
    }
  }
  if (rows.length) {
    const { error: insertError } = await db.from("crm_lead_doctor_compensation").insert(rows);
    if (insertError) throw new FinancialError(`Could not apply doctor compensation: ${insertError.message}`);
  }
}

export async function updateBillServicePrice(itemId: string, billPrice: number): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");
  const amount = roundMoney(billPrice);
  if (!Number.isFinite(amount) || amount < 0) throw new FinancialError("Enter a valid bill price.");
  const db = supabaseAdmin();
  const { data: before, error } = await db.from("crm_lead_bundle_items").select("*,crm_lead_financials!inner(lead_id)").eq("id", itemId).maybeSingle();
  if (error || !before) throw new FinancialError("Service line not found.");
  const { count } = await db.from("crm_financial_transactions").select("id", { count: "exact", head: true }).eq("lead_financials_id", before.lead_financials_id).eq("status", "completed");
  if ((count ?? 0) > 0) throw new FinancialError("This bill has finalized financial activity. Reverse or reconcile the payment before editing a service price.");
  const { error: updateError } = await db.from("crm_lead_bundle_items").update({ base_price: amount }).eq("id", itemId);
  if (updateError) throw new FinancialError(updateError.message);
  const total = await recalculateServiceTotal(before.lead_financials_id as string, true);
  await audit(actor, { entityType: "lead_bundle_item", entityId: itemId, action: "service_bill_price_changed", field: "base_price", oldValue: before.base_price, newValue: amount });
  await leadLog(actor, { leadUid: (before.crm_lead_financials as { lead_id: string }).lead_id, action: "lead.payment_service_price_changed", title: "Service bill price changed", field: "bill_price", oldValue: before.base_price, newValue: amount, metadata: { service_name: before.service_name, new_bill_total: total } });
}

export async function removeBillService(itemId: string, reason?: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");
  const db = supabaseAdmin();
  const { data: before, error } = await db.from("crm_lead_bundle_items").select("*,crm_lead_financials!inner(lead_id)").eq("id", itemId).maybeSingle();
  if (error || !before) throw new FinancialError("Service line not found.");
  const { count } = await db.from("crm_financial_transactions").select("id", { count: "exact", head: true }).eq("lead_financials_id", before.lead_financials_id).eq("status", "completed");
  if ((count ?? 0) > 0) throw new FinancialError("This bill has finalized financial activity. Reverse or reconcile the payment before removing a service.");
  const { error: compError } = await db.from("crm_lead_doctor_compensation").delete().eq("bundle_item_id", itemId);
  if (compError) throw new FinancialError(`Could not remove linked compensation: ${compError.message}`);
  const { error: deleteError } = await db.from("crm_lead_bundle_items").delete().eq("id", itemId);
  if (deleteError) throw new FinancialError(deleteError.message);
  const total = await recalculateServiceTotal(before.lead_financials_id as string, true);
  await audit(actor, { entityType: "lead_bundle_item", entityId: itemId, action: "service_removed", oldValue: before, newValue: null, reason });
  await leadLog(actor, { leadUid: (before.crm_lead_financials as { lead_id: string }).lead_id, action: "lead.payment_service_removed", title: "Service removed from bill", body: reason?.trim() || null, oldValue: before, newValue: { bill_total: total } });
}

export async function addBundleToLeadFinancials(leadId: string, bundleId: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");
  const lead = await leadRow(leadId);
  const record = await ensureRecord(actor, lead);
  const db = supabaseAdmin();
  const day = today();
  const { data: offer, error } = await db.from("crm_financial_bundles").select("id,name,price,currency,specialty_id,starts_on,expires_on").eq("id", bundleId).eq("active", true).maybeSingle();
  if (error || !offer) throw new FinancialError("This bundle is no longer available.");
  if (offer.specialty_id && offer.specialty_id !== leadSpecialtyId(lead)) throw new FinancialError("This bundle is not available for the lead's specialty.");
  if ((offer.starts_on && offer.starts_on > day) || (offer.expires_on && offer.expires_on < day)) throw new FinancialError("This bundle is outside its availability window.");
  const { count: existing } = await db.from("crm_lead_bundle_items").select("id", { count: "exact", head: true }).eq("lead_financials_id", record.id).eq("source_kind", "bundle").eq("source_rule_id", bundleId);
  if ((existing ?? 0) > 0) throw new FinancialError("This bundle is already on the bill.");
  const { data: components, error: componentError } = await db.from("crm_financial_bundle_components").select("service_id,service_name,quantity,doctor_id,doctor_name,compensation_kind,compensation_value,compensation_basis").eq("bundle_id", bundleId).order("display_order");
  if (componentError || !components?.length) throw new FinancialError("This bundle has no configured services.");
  const serviceIds = components.map((component) => component.service_id).filter(Boolean) as string[];
  const { data: settings } = serviceIds.length ? await db.from("crm_financial_service_settings").select("id,service_id,service_name,base_price").in("service_id", serviceIds) : { data: [] };
  const listPrices = components.map((component) => {
    const setting = (settings ?? []).find((candidate) => candidate.service_id === component.service_id) as { id: string; base_price: number } | undefined;
    return { component, setting, listPrice: roundMoney(num(setting?.base_price) * Math.max(0.01, num(component.quantity) || 1)) };
  });
  const listTotal = listPrices.reduce((sum, item) => sum + item.listPrice, 0);
  let allocated = 0;
  const rows = listPrices.map((item, index) => {
    const billPrice = index === listPrices.length - 1
      ? roundMoney(num(offer.price) - allocated)
      : roundMoney(listTotal > 0 ? num(offer.price) * item.listPrice / listTotal : num(offer.price) / listPrices.length);
    allocated = roundMoney(allocated + billPrice);
    return { lead_financials_id: record.id, service_settings_id: item.setting?.id ?? null, service_id: item.component.service_id ?? null, service_name: item.component.service_name, list_price: item.listPrice, base_price: billPrice, source_kind: "bundle", source_rule_id: bundleId, source_label: offer.name, created_by: actor.id };
  });
  const { data: inserted, error: insertError } = await db.from("crm_lead_bundle_items").insert(rows).select("id,service_name");
  if (insertError || !inserted) throw new FinancialError(insertError?.message ?? "Could not add bundle.");
  const compensations = inserted.flatMap((item, index) => {
    const component = components[index];
    if (!component.doctor_id || !component.compensation_kind || component.compensation_value == null) return [];
    return [{ lead_financials_id: record.id, bundle_item_id: item.id, doctor_id: component.doctor_id, doctor_name: component.doctor_name, kind: component.compensation_kind, value: component.compensation_value, basis: component.compensation_basis ?? "quoted_price", computed_amount: 0, created_by: actor.id }];
  });
  if (compensations.length) {
    const { error: compError } = await db.from("crm_lead_doctor_compensation").insert(compensations);
    if (compError) throw new FinancialError(`Could not apply bundle compensation: ${compError.message}`);
  }
  const total = await recalculateServiceTotal(record.id, true);
  await audit(actor, { entityType: "lead_financials", entityId: record.id, action: "bundle_added_to_lead", newValue: { lead_id: lead.lead_id, bundle_id: bundleId, service_lines: inserted, bill_total: total } });
  await leadLog(actor, { leadUid: lead.id, action: "lead.payment_bundle_added", title: `Bundle unlocked and added: ${offer.name}`, newValue: { bundle_id: bundleId, bill_total: total } });
}

export async function addUnlockedAddonToLeadFinancials(leadId: string, ruleId: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");
  const lead = await leadRow(leadId);
  const record = await ensureRecord(actor, lead);
  const db = supabaseAdmin();
  const { data: rule, error } = await db.from("crm_service_addon_rules").select("*").eq("id", ruleId).eq("active", true).maybeSingle();
  if (error || !rule) throw new FinancialError("This add-on is no longer available.");
  if (!addonWithinRedemptionWindow(record.service_date, num(rule.redeem_within_days))) throw new FinancialError("This conditional add-on has passed its redemption window.");
  const { data: items } = await db.from("crm_lead_bundle_items").select("service_id,service_name,source_kind,source_rule_id").eq("lead_financials_id", record.id);
  const unlocked = (items ?? []).some((item) => (rule.trigger_service_id && item.service_id === rule.trigger_service_id) || String(item.service_name).toLowerCase() === String(rule.trigger_service_name).toLowerCase());
  if (!unlocked) throw new FinancialError("Add the required service before using this conditional add-on.");
  if ((items ?? []).some((item) => item.source_kind === "addon" && item.source_rule_id === ruleId)) throw new FinancialError("This add-on is already on the bill.");
  const settingQuery = db.from("crm_financial_service_settings").select("id,service_id,service_name,base_price").eq("active", true).limit(1);
  const { data: setting } = await (rule.addon_service_id
    ? settingQuery.eq("service_id", rule.addon_service_id)
    : settingQuery.ilike("service_name", rule.addon_service_name)).maybeSingle();
  const { data: inserted, error: insertError } = await db.from("crm_lead_bundle_items").insert({ lead_financials_id: record.id, service_settings_id: setting?.id ?? null, service_id: setting?.service_id ?? rule.addon_service_id ?? null, service_name: rule.addon_service_name, list_price: num(setting?.base_price), base_price: num(rule.addon_price), source_kind: "addon", source_rule_id: ruleId, source_label: `Unlocked by ${rule.trigger_service_name}`, created_by: actor.id }).select("id,service_name").single();
  if (insertError || !inserted) throw new FinancialError(insertError?.message ?? "Could not add add-on.");
  await applyCompensationRules(actor, lead, record.id, [{ id: inserted.id as string, serviceId: (setting?.service_id as string | null | undefined) ?? null, serviceName: inserted.service_name as string }]);
  const total = await recalculateServiceTotal(record.id, true);
  await audit(actor, { entityType: "lead_financials", entityId: record.id, action: "unlocked_addon_added", newValue: { lead_id: lead.lead_id, rule_id: ruleId, addon_service: rule.addon_service_name, bill_total: total } });
  await leadLog(actor, { leadUid: lead.id, action: "lead.payment_addon_unlocked", title: `Conditional add-on unlocked: ${rule.addon_service_name}`, newValue: { rule_id: ruleId, bill_total: total } });
}

/* ── write ────────────────────────────────────────────────────── */

/**
 * Get the lead's financial record, creating it on first write.
 *
 * Creation is the moment `base_service_price` is frozen (§2). A later change to
 * the service's list price never restates this patient's bill.
 */
async function ensureRecord(actor: SessionUser, lead: LeadRow): Promise<RecordRow> {
  const existing = await fetchRecord(lead.id);
  if (existing) return existing;

  const { basePrice, settingsId } = await lookupBasePrice(lead);
  const { maxPct } = await resolveCeiling(lead, today(), actor.id);

  const { data, error } = await supabaseAdmin()
    .from("crm_lead_financials")
    .insert({
      lead_id: lead.id,
      service_settings_id: settingsId,
      service_name: lead.service_name,
      base_service_price: basePrice,
      max_allowed_discount_pct: maxPct,
      created_by: actor.id,
    })
    .select(RECORD_COLS)
    .single<RecordRow>();
  if (error || !data) {
    throw new FinancialError(error?.message ?? "Could not create the financial record.");
  }

  await audit(actor, {
    entityType: "lead_financials",
    entityId: data.id,
    action: "create",
    newValue: { leadId: lead.lead_id, basePrice, maxAllowedDiscountPct: maxPct },
  });
  return data;
}

export interface SaveQuoteInput {
  leadId: string;
  /** The hand-entered agreed price. */
  quotedPrice: number;
  /** Only meaningful for an approver overriding a below-allowed price. */
  force?: boolean;
  /** Mandatory when `force` is true. */
  reason?: string;
  serviceDate?: string | null;
  financialNotes?: string | null;
}

/**
 * Record the manually agreed quoted price (§1B, §5).
 *
 * The ceiling is re-resolved from the live rules and the quote re-evaluated
 * here, on the server. A below-allowed quote is REFUSED unless the caller both
 * holds `financial.forceExceptionalPrice` and supplies a reason; a forced quote
 * is flagged `is_exceptional`, which is what surfaces the red
 * "Quoted price lower than allowed" tag on the Admin and Auditor dashboards.
 */
export async function saveQuote(input: SaveQuoteInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");

  if (!Number.isFinite(input.quotedPrice) || input.quotedPrice < 0) {
    throw new FinancialError("Enter a valid quoted price.");
  }

  const lead = await leadRow(input.leadId);
  const record = await ensureRecord(actor, lead);
  const onDate = input.serviceDate ?? record.service_date ?? today();
  const { maxPct } = await resolveCeiling(lead, onDate, actor.id);

  const viewerCanForce = can(actor.role, "financial.forceExceptionalPrice");
  const verdict = evaluateQuote({
    baseServicePrice: num(record.base_service_price),
    quotedPrice: input.quotedPrice,
    maxAllowedDiscountPct: maxPct,
    viewerCanForce,
  });

  if (verdict.status === "invalid") throw new FinancialError(verdict.message ?? "Invalid price.");

  const forcing = verdict.status === "below_allowed";
  if (forcing) {
    if (!input.force) {
      throw new FinancialError(
        `${verdict.message} Escalate for approval, or ask an admin or auditor to approve it.`,
      );
    }
    // Re-check the capability here rather than trusting `verdict.canForce`, which
    // was computed from the same role but is a display concern.
    assertCan(actor.role, "financial.forceExceptionalPrice");
    if (!input.reason?.trim()) {
      throw new FinancialError("A reason is required to approve a price below the allowed discount.");
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    quoted_price: roundMoney(input.quotedPrice),
    max_allowed_discount_pct: maxPct,
    is_exceptional: forcing,
    exceptional_reason: forcing ? input.reason!.trim() : null,
    exceptional_by: forcing ? actor.id : null,
    exceptional_at: forcing ? now : null,
    updated_at: now,
  };
  if (input.serviceDate !== undefined) patch.service_date = input.serviceDate;
  if (input.financialNotes !== undefined) patch.financial_notes = input.financialNotes;

  const { error } = await supabaseAdmin()
    .from("crm_lead_financials")
    .update(patch)
    .eq("id", record.id);
  if (error) throw new FinancialError(error.message);

  await audit(actor, {
    entityType: "lead_financials",
    entityId: record.id,
    action: forcing ? "force_price" : "update",
    field: "quoted_price",
    oldValue: record.quoted_price,
    newValue: roundMoney(input.quotedPrice),
    reason: forcing ? input.reason : null,
  });
  await leadLog(actor, {
    leadUid: lead.id,
    action: forcing ? "lead.payment_quote_forced" : "lead.payment_quote_updated",
    title: forcing ? "Payment quote approved below limit" : "Payment quote updated",
    body: forcing ? input.reason?.trim() ?? null : null,
    field: "quoted_price",
    oldValue: record.quoted_price,
    newValue: roundMoney(input.quotedPrice),
    metadata: {
      lead_id: lead.lead_id,
      record_id: record.id,
      service_date: input.serviceDate ?? record.service_date ?? null,
      financial_notes_changed: input.financialNotes !== undefined,
    },
  });
}

/** Remove a manual quote while retaining a complete financial audit entry. */
export async function clearQuote(leadId: string): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");
  const lead = await leadRow(leadId);
  const record = await ensureRecord(actor, lead);
  const { error } = await supabaseAdmin().from("crm_lead_financials").update({ quoted_price: null, is_exceptional: false, exceptional_reason: null, exceptional_by: null, exceptional_at: null, updated_at: new Date().toISOString() }).eq("id", record.id);
  if (error) throw new FinancialError(error.message);
  await audit(actor, { entityType: "lead_financials", entityId: record.id, action: "delete", field: "quoted_price", oldValue: record.quoted_price, newValue: null });
}

export async function updateTransaction(input: { transactionId: string; amount: number; method: PaymentMethod | null; occurredOn: string; note: string | null }): Promise<void> {
  const actor = await writeActor(); assertCan(actor.role, "financial.editLeadRecord");
  const db = supabaseAdmin();
  const { data: before, error: readError } = await db.from("crm_financial_transactions").select("*").eq("id", input.transactionId).single();
  if (readError || !before) throw new FinancialError("Transaction not found.");
  if (actor.role === "moderator" && before.created_by !== actor.id) throw new FinancialError("Moderators can only modify transactions they added.");
  const amount = roundMoney(input.amount); if (!Number.isFinite(amount) || amount <= 0) throw new FinancialError("Enter an amount greater than zero.");
  const patch = { amount, method: input.method, occurred_on: input.occurredOn || before.occurred_on, note: input.note?.trim() || null };
  const { error } = await db.from("crm_financial_transactions").update(patch).eq("id", input.transactionId); if (error) throw new FinancialError(error.message);
  await audit(actor, { entityType: "financial_transaction", entityId: input.transactionId, action: "update", oldValue: before, newValue: patch });
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const actor = await writeActor(); assertCan(actor.role, "financial.editLeadRecord");
  const db = supabaseAdmin();
  const { data: before, error: readError } = await db.from("crm_financial_transactions").select("*").eq("id", transactionId).single();
  if (readError || !before) throw new FinancialError("Transaction not found.");
  if (actor.role === "moderator" && before.created_by !== actor.id) throw new FinancialError("Moderators can only delete transactions they added.");
  const { error } = await db.from("crm_financial_transactions").delete().eq("id", transactionId); if (error) throw new FinancialError("This transaction cannot be deleted because another financial entry depends on it. Reverse it instead.");
  await audit(actor, { entityType: "financial_transaction", entityId: transactionId, action: "delete", oldValue: before, newValue: null });
}

const LINE_TABLE = { consumable: "crm_lead_consumables", doctor_payment: "crm_doctor_funded_payments", external_cost: "crm_external_costs" } as const;
export async function updateFinancialLine(input: { type: keyof typeof LINE_TABLE; id: string; amount: number; description?: string; quantity?: number; occurredOn?: string }): Promise<void> {
  const actor = await writeActor(); assertCan(actor.role, "financial.editRules");
  const table = LINE_TABLE[input.type]; const db = supabaseAdmin();
  const { data: before } = await db.from(table).select("*").eq("id", input.id).single(); if (!before) throw new FinancialError("Financial line not found.");
  const amount = roundMoney(input.amount); if (!Number.isFinite(amount) || amount < 0) throw new FinancialError("Enter a valid amount.");
  const patch: Record<string, unknown> = input.type === "consumable" ? { unit_cost: amount, quantity: input.quantity ?? 1, description: input.description?.trim() || before.description } : input.type === "external_cost" ? { amount, description: input.description?.trim() || before.description, occurred_on: input.occurredOn || before.occurred_on } : { amount, occurred_on: input.occurredOn || before.occurred_on };
  const { error } = await db.from(table).update(patch).eq("id", input.id); if (error) throw new FinancialError(error.message);
  await audit(actor, { entityType: input.type, entityId: input.id, action: "update", oldValue: before, newValue: patch });
}
export async function deleteFinancialLine(type: keyof typeof LINE_TABLE, id: string): Promise<void> {
  const actor = await writeActor(); assertCan(actor.role, "financial.editRules"); const table = LINE_TABLE[type]; const db = supabaseAdmin();
  const { data: before } = await db.from(table).select("*").eq("id", id).single(); if (!before) throw new FinancialError("Financial line not found.");
  const { error } = await db.from(table).delete().eq("id", id); if (error) throw new FinancialError(error.message);
  await audit(actor, { entityType: type, entityId: id, action: "delete", oldValue: before, newValue: null });
}

export interface AddTransactionInput {
  leadId: string;
  kind: TransactionKind;
  amount: number;
  method?: PaymentMethod | null;
  status?: TransactionStatus;
  occurredOn?: string;
  reference?: string | null;
  receiptNumber?: string | null;
  note?: string | null;
  /** Required for `refund` / `reversal` / `chargeback`: the line being undone. */
  reversesTransactionId?: string | null;
}

const REVERSING: TransactionKind[] = ["refund", "reversal", "chargeback"];

/**
 * Append one line to the money ledger (§1C–E).
 *
 * Never updates or deletes an existing row. A refund/reversal/chargeback must
 * name the original line it undoes and may not, together with any earlier
 * reversals of that line, exceed the original amount.
 */
export async function addTransaction(input: AddTransactionInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");

  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new FinancialError("Enter an amount greater than zero.");
  }
  if (input.kind === "doctor_funded") {
    throw new FinancialError("Record a doctor's payment with addDoctorFundedPayment, so it carries the doctor.");
  }

  const lead = await leadRow(input.leadId);
  const record = await ensureRecord(actor, lead);

  if (REVERSING.includes(input.kind)) {
    if (!input.reversesTransactionId) {
      throw new FinancialError("Select the payment this reverses. Originals are never deleted.");
    }
    await assertReversalFits(record.id, input.reversesTransactionId, amount);
  }

  const { data, error } = await supabaseAdmin()
    .from("crm_financial_transactions")
    .insert({
      lead_financials_id: record.id,
      lead_id: lead.id,
      kind: input.kind,
      amount,
      method: input.method ?? null,
      status: input.status ?? "completed",
      occurred_on: input.occurredOn ?? today(),
      reference: input.reference?.trim() || null,
      receipt_number: input.receiptNumber?.trim() || null,
      note: input.note?.trim() || null,
      reverses_transaction_id: input.reversesTransactionId ?? null,
      created_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new FinancialError(error?.message ?? "Could not record the transaction.");

  await audit(actor, {
    entityType: "financial_transaction",
    entityId: data.id,
    action: "create",
    newValue: {
      kind: input.kind,
      amount,
      method: input.method ?? null,
      status: input.status ?? "completed",
      occurredOn: input.occurredOn ?? today(),
    },
    reason: input.note,
  });
  await leadLog(actor, {
    leadUid: lead.id,
    action: "lead.payment_transaction_added",
    title: "Payment transaction added",
    body: input.note?.trim() || null,
    field: "transaction",
    newValue: {
      transaction_id: data.id,
      kind: input.kind,
      amount,
      status: input.status ?? "completed",
      occurred_on: input.occurredOn ?? today(),
    },
    metadata: { lead_id: lead.lead_id, record_id: record.id },
  });
}

/** A reversal may not take back more than the original settled line gave. */
async function assertReversalFits(
  recordId: string,
  originalId: string,
  amount: number,
): Promise<void> {
  const db = supabaseAdmin();
  const { data: original } = await db
    .from("crm_financial_transactions")
    .select("id, kind, amount, status, lead_financials_id")
    .eq("id", originalId)
    .maybeSingle<{ id: string; kind: TransactionKind; amount: number; status: TransactionStatus; lead_financials_id: string }>();

  if (!original || original.lead_financials_id !== recordId) {
    throw new FinancialError("That payment does not belong to this lead.");
  }
  if (original.kind !== "payment") {
    throw new FinancialError("Only a payment can be refunded or reversed.");
  }
  if (original.status !== "completed") {
    throw new FinancialError("Only a completed payment can be refunded or reversed.");
  }

  const { data: priorRows } = await db
    .from("crm_financial_transactions")
    .select("amount, status")
    .eq("reverses_transaction_id", originalId)
    .returns<{ amount: number; status: TransactionStatus }[]>();

  const alreadyReversed = addMoney(
    ...(priorRows ?? []).filter((r) => r.status === "completed").map((r) => num(r.amount)),
  );
  const remaining = roundMoney(num(original.amount) - alreadyReversed);
  if (amount > remaining) {
    throw new FinancialError(
      `That payment has ${remaining.toFixed(2)} left to reverse; ${amount.toFixed(2)} is more than remains.`,
    );
  }
}

/**
 * Move a payment line through its lifecycle (pending → completed / failed /
 * cancelled). This is the ONLY permitted update to a ledger row: amount, kind,
 * method and date are immutable once written.
 */
export async function setTransactionStatus(
  transactionId: string,
  status: TransactionStatus,
  reason?: string,
): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");

  const { data: row } = await supabaseAdmin()
    .from("crm_financial_transactions")
    .select("id, status, lead_id, kind, amount")
    .eq("id", transactionId)
    .maybeSingle<{ id: string; status: TransactionStatus; lead_id: string; kind: TransactionKind; amount: number }>();
  if (!row) throw new FinancialError("That transaction no longer exists.");
  if (row.status === status) return;
  if (row.status !== "pending") {
    throw new FinancialError(
      `A ${row.status} payment is final. Record a reversal instead of changing it.`,
    );
  }

  const { error } = await supabaseAdmin()
    .from("crm_financial_transactions")
    .update({ status })
    .eq("id", transactionId);
  if (error) throw new FinancialError(error.message);

  await audit(actor, {
    entityType: "financial_transaction",
    entityId: transactionId,
    action: "update",
    field: "status",
    oldValue: row.status,
    newValue: status,
    reason,
  });
  await leadLog(actor, {
    leadUid: row.lead_id,
    action: "lead.payment_status_changed",
    title: "Payment status changed",
    body: reason?.trim() || null,
    field: "status",
    oldValue: row.status,
    newValue: status,
    metadata: { transaction_id: transactionId, kind: row.kind, amount: row.amount },
  });
}

export interface DoctorFundedInput {
  leadId: string;
  doctorId: string;
  doctorName?: string | null;
  amount: number;
  occurredOn?: string;
  note?: string | null;
  reference?: string | null;
  /** Does this settle part of the patient's bill? (§ payment by doctor) */
  reducesPatientBalance: boolean;
}

/** Record a payment the doctor personally made toward a patient's bill. */
export async function addDoctorFundedPayment(input: DoctorFundedInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editRules");

  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new FinancialError("Enter an amount greater than zero.");
  }
  if (!input.doctorId) throw new FinancialError("Select the doctor making this payment.");

  const lead = await leadRow(input.leadId);
  const record = await ensureRecord(actor, lead);
  let doctorName = input.doctorName?.trim() || null;
  if (!doctorName) {
    const doctors = await financialDoctorOptions();
    doctorName = doctors.find((doctor) => doctor.id === input.doctorId)?.name ?? null;
  }
  const { data, error } = await supabaseAdmin()
    .from("crm_doctor_funded_payments")
    .insert({
      lead_financials_id: record.id,
      lead_id: lead.id,
      doctor_id: input.doctorId,
      doctor_name: doctorName,
      amount,
      occurred_on: input.occurredOn ?? today(),
      note: input.note?.trim() || null,
      reference: input.reference?.trim() || null,
      reduces_patient_balance: input.reducesPatientBalance,
      created_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new FinancialError(error?.message ?? "Could not record the payment.");

  await audit(actor, {
    entityType: "doctor_funded_payment",
    entityId: data.id,
    action: "create",
    newValue: {
      doctorId: input.doctorId,
      doctorName,
      amount,
      reducesPatientBalance: input.reducesPatientBalance,
    },
    reason: input.note,
  });
  await leadLog(actor, {
    leadUid: lead.id,
    action: "lead.doctor_funded_payment_added",
    title: "Doctor-funded payment added",
    body: input.note?.trim() || null,
    field: "doctor_funded_payment",
    newValue: {
      doctor_id: input.doctorId,
      doctor_name: doctorName,
      amount,
      reduces_patient_balance: input.reducesPatientBalance,
    },
    metadata: { lead_id: lead.lead_id, record_id: record.id, payment_id: data.id },
  });
}

export interface ConsumableInput {
  leadId: string;
  description: string;
  quantity: number;
  unitCost: number;
  /** True when this overrides the service default for this patient. */
  isOverride?: boolean;
  /** Required when `isOverride`. */
  overrideReason?: string;
  componentId?: string | null;
}

/** Add a consumable line (§ consumables). A patient-specific override needs a reason. */
export async function addConsumable(input: ConsumableInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editRules");

  if (!input.description.trim()) throw new FinancialError("Describe the consumable.");
  const quantity = num(input.quantity);
  const unitCost = roundMoney(input.unitCost);
  if (quantity <= 0) throw new FinancialError("Quantity must be greater than zero.");
  if (unitCost < 0) throw new FinancialError("A unit cost cannot be negative.");
  if (input.isOverride && !input.overrideReason?.trim()) {
    throw new FinancialError("A patient-specific override requires a reason.");
  }

  const lead = await leadRow(input.leadId);
  const record = await ensureRecord(actor, lead);
  const { data, error } = await supabaseAdmin()
    .from("crm_lead_consumables")
    .insert({
      lead_financials_id: record.id,
      component_id: input.componentId ?? null,
      description: input.description.trim(),
      quantity,
      unit_cost: unitCost,
      is_override: input.isOverride ?? false,
      override_reason: input.isOverride ? input.overrideReason!.trim() : null,
      created_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new FinancialError(error?.message ?? "Could not add the consumable.");

  await audit(actor, {
    entityType: "lead_consumable",
    entityId: data.id,
    action: input.isOverride ? "override" : "create",
    newValue: { description: input.description.trim(), quantity, unitCost },
    reason: input.overrideReason,
  });
  await leadLog(actor, {
    leadUid: lead.id,
    action: input.isOverride ? "lead.consumable_override_added" : "lead.consumable_added",
    title: input.isOverride ? "Consumable override added" : "Consumable added",
    body: input.overrideReason?.trim() || null,
    field: "consumable",
    newValue: { description: input.description.trim(), quantity, unit_cost: unitCost },
    metadata: { lead_id: lead.lead_id, record_id: record.id, consumable_id: data.id },
  });
}

export interface ExternalCostInput {
  leadId: string;
  category: ExternalCostCategory;
  description: string;
  amount: number;
  vendor?: string | null;
  occurredOn?: string;
  notes?: string | null;
  reference?: string | null;
}

/** Add an external cost line (§ external payments and costs). */
export async function addExternalCost(input: ExternalCostInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editRules");

  if (!input.description.trim()) throw new FinancialError("Describe the external cost.");
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new FinancialError("Enter an amount greater than zero.");
  }

  const lead = await leadRow(input.leadId);
  const record = await ensureRecord(actor, lead);
  const { data, error } = await supabaseAdmin()
    .from("crm_external_costs")
    .insert({
      lead_financials_id: record.id,
      category: input.category,
      description: input.description.trim(),
      amount,
      vendor: input.vendor?.trim() || null,
      occurred_on: input.occurredOn ?? today(),
      notes: input.notes?.trim() || null,
      reference: input.reference?.trim() || null,
      created_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new FinancialError(error?.message ?? "Could not add the cost.");

  await audit(actor, {
    entityType: "external_cost",
    entityId: data.id,
    action: "create",
    newValue: { category: input.category, description: input.description.trim(), amount },
    reason: input.notes,
  });
  await leadLog(actor, {
    leadUid: lead.id,
    action: "lead.external_cost_added",
    title: "External cost added",
    body: input.notes?.trim() || null,
    field: "external_cost",
    newValue: { category: input.category, description: input.description.trim(), amount },
    metadata: { lead_id: lead.lead_id, record_id: record.id, external_cost_id: data.id },
  });
}

export interface DoctorCompInput {
  leadId: string;
  doctorId: string;
  doctorName?: string | null;
  kind: "percentage" | "fixed";
  value: number;
  basis?: "quoted_price" | "net_after_consumables";
}

/**
 * Attach a doctor's compensation line to this lead (§ doctor compensation).
 *
 * Several doctors may share one bundle, each on their own terms — one fixed,
 * one percentage. The percentage basis defaults to `net_after_consumables`,
 * which is the spec's rule: a percentage is taken on the actual revenue after
 * discount, minus applicable consumables — never on the original list price.
 */
export async function addDoctorCompensation(input: DoctorCompInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editRules");

  if (!input.doctorId) throw new FinancialError("Select a doctor.");
  const value = num(input.value);
  if (value < 0) throw new FinancialError("A compensation value cannot be negative.");
  if (input.kind === "percentage" && value > 100) {
    throw new FinancialError("A percentage cannot exceed 100.");
  }

  const record = await ensureRecord(actor, await leadRow(input.leadId));
  const basis = input.basis ?? "net_after_consumables";

  const { data, error } = await supabaseAdmin()
    .from("crm_lead_doctor_compensation")
    .insert({
      lead_financials_id: record.id,
      doctor_id: input.doctorId,
      doctor_name: input.doctorName ?? null,
      kind: input.kind,
      value,
      basis,
      created_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new FinancialError(error?.message ?? "Could not add the compensation line.");

  await audit(actor, {
    entityType: "lead_doctor_compensation",
    entityId: data.id,
    action: "create",
    newValue: { doctorId: input.doctorId, kind: input.kind, value, basis },
  });
}

/* ── exceptional-price approval flow (§5) ─────────────────────── */

export interface ApprovalRequestInput {
  leadId: string;
  quotedPrice: number;
  reason: string;
}

/**
 * A moderator asks for a below-allowed price through the EXISTING escalation
 * system (§5): one `escalations` row carries the workflow, one
 * `crm_discount_approvals` row carries the numbers, and they are linked.
 */
export async function requestDiscountApproval(input: ApprovalRequestInput): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editLeadRecord");

  if (!input.reason.trim()) {
    throw new FinancialError("A reason is required to escalate a price for approval.");
  }

  const lead = await leadRow(input.leadId);
  const record = await ensureRecord(actor, lead);
  const { maxPct } = await resolveCeiling(lead, record.service_date ?? today(), actor.id);
  const verdict = evaluateQuote({
    baseServicePrice: num(record.base_service_price),
    quotedPrice: input.quotedPrice,
    maxAllowedDiscountPct: maxPct,
    viewerCanForce: false,
  });
  if (verdict.status !== "below_allowed") {
    throw new FinancialError("That price is already within the allowed discount — no approval is needed.");
  }

  const db = supabaseAdmin();
  const { data: esc, error: escError } = await db
    .from("escalations")
    .insert({
      lead_id: lead.id,
      status: "escalated",
      severity: "high",
      reason: `Quoted price lower than allowed: ${input.reason.trim()}`,
      requested_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (escError || !esc) throw new FinancialError(escError?.message ?? "Could not raise the escalation.");

  const { data, error } = await db
    .from("crm_discount_approvals")
    .insert({
      lead_id: lead.id,
      lead_financials_id: record.id,
      escalation_id: esc.id,
      requested_by: actor.id,
      base_service_price: num(record.base_service_price),
      requested_quoted_price: roundMoney(input.quotedPrice),
      max_allowed_pct: maxPct,
      requested_pct: verdict.effectiveDiscountPct,
      status: "pending",
      reason: input.reason.trim(),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new FinancialError(error?.message ?? "Could not record the request.");

  await audit(actor, {
    entityType: "discount_approval",
    entityId: data.id,
    action: "request",
    newValue: {
      requestedQuotedPrice: roundMoney(input.quotedPrice),
      requestedPct: verdict.effectiveDiscountPct,
      maxAllowedPct: maxPct,
      escalationId: esc.id,
    },
    reason: input.reason,
  });
}

/**
 * An admin/auditor approves or rejects a below-allowed price.
 *
 * Approving writes the granted price onto the record and flags it exceptional,
 * so the red "Quoted price lower than allowed" tag stays visible on the Admin
 * and Auditor dashboards. The linked escalation is resolved either way.
 */
export async function decideDiscountApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  reason: string,
  approvedQuotedPrice?: number,
): Promise<void> {
  const actor = await writeActor();
  assertCan(actor.role, "financial.approveDiscount");

  if (!reason.trim()) throw new FinancialError("A reason is required to decide an approval.");

  const db = supabaseAdmin();
  const { data: req } = await db
    .from("crm_discount_approvals")
    .select("id, lead_id, lead_financials_id, escalation_id, requested_quoted_price, status")
    .eq("id", approvalId)
    .maybeSingle<{
      id: string;
      lead_id: string;
      lead_financials_id: string | null;
      escalation_id: string | null;
      requested_quoted_price: number;
      status: ApprovalRequest["status"];
    }>();
  if (!req) throw new FinancialError("That request no longer exists.");
  if (req.status !== "pending") throw new FinancialError("That request has already been decided.");

  const granted =
    decision === "approved"
      ? roundMoney(approvedQuotedPrice ?? num(req.requested_quoted_price))
      : null;

  const now = new Date().toISOString();
  const { error } = await db
    .from("crm_discount_approvals")
    .update({
      status: decision,
      decided_by: actor.id,
      decided_at: now,
      approved_quoted_price: granted,
      reason: reason.trim(),
    })
    .eq("id", approvalId);
  if (error) throw new FinancialError(error.message);

  if (decision === "approved" && req.lead_financials_id) {
    const { error: recError } = await db
      .from("crm_lead_financials")
      .update({
        quoted_price: granted,
        is_exceptional: true,
        exceptional_reason: reason.trim(),
        exceptional_by: actor.id,
        exceptional_at: now,
        updated_at: now,
      })
      .eq("id", req.lead_financials_id);
    if (recError) throw new FinancialError(recError.message);
  }

  if (req.escalation_id) {
    await db
      .from("escalations")
      .update({
        status: "resolved",
        resolved_by: actor.id,
        resolved_at: now,
        notes: reason.trim(),
        updated_at: now,
      })
      .eq("id", req.escalation_id);
  }

  await audit(actor, {
    entityType: "discount_approval",
    entityId: approvalId,
    action: decision === "approved" ? "approve" : "reject",
    field: "quoted_price",
    oldValue: num(req.requested_quoted_price),
    newValue: granted,
    reason,
  });
}

export { ActorError };
