import "server-only";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth/permissions";
import { writeActor } from "@/lib/data/actor";
import { logActivity } from "@/lib/audit/log";
import { createFinancialDoctor } from "@/lib/booking/service";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ExternalCostCategory } from "@/lib/data/financials";

export class FinancialSettingsError extends Error {}

async function actor() {
  const a = await writeActor();
  assertCan(a.role, "financial.editRules");
  return a;
}

function money(v: number): number {
  if (!Number.isFinite(v) || v < 0) throw new FinancialSettingsError("Enter a non-negative amount.");
  return Math.round(v * 100) / 100;
}

async function auditSetting(params: {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}) {
  await logActivity({
    actorId: params.actorId,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    oldValues: params.oldValues ?? {},
    newValues: params.newValues ?? {},
    metadata: { domain: "financial_settings" },
  });
}

export async function upsertServicePrice(input: {
  id?: string | null;
  serviceId?: string | null;
  serviceName: string;
  basePrice: number;
  currency?: string;
  defaultConsumablesCost?: number;
  active: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): Promise<void> {
  const a = await actor();
  const serviceName = input.serviceName.trim();
  if (!serviceName) throw new FinancialSettingsError("Service name is required.");
  const db = supabaseAdmin();
  const patch = {
    service_id: input.serviceId || null,
    service_name: serviceName,
    base_price: money(input.basePrice),
    currency: input.currency?.trim() || "EGP",
    default_consumables_cost: money(input.defaultConsumablesCost ?? 0),
    active: input.active,
    effective_from: input.effectiveFrom || null,
    effective_to: input.effectiveTo || null,
    created_by: a.id,
  };
  if (input.id) {
    const { data: before } = await db.from("crm_financial_service_settings").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_financial_service_settings").update(patch).eq("id", input.id);
    if (error) throw new FinancialSettingsError(error.message);
    await auditSetting({ actorId: a.id, action: "financial.service_price_updated", entityType: "financial_service_setting", entityId: input.id, oldValues: (before ?? {}) as Record<string, unknown>, newValues: patch });
  } else {
    const { data, error } = await db.from("crm_financial_service_settings").insert(patch).select("id").single();
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create service pricing.");
    await auditSetting({ actorId: a.id, action: "financial.service_price_created", entityType: "financial_service_setting", entityId: data.id as string, newValues: patch });
  }
  revalidatePath("/financial/settings");
  revalidatePath("/financial");
}

export async function upsertDiscountRule(input: {
  id?: string | null;
  scope: "moderator_service" | "moderator" | "service" | "global";
  moderatorId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  maxDiscountPct: number;
  active: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): Promise<void> {
  const a = await actor();
  if (input.maxDiscountPct < 0 || input.maxDiscountPct > 100) throw new FinancialSettingsError("Discount must be between 0 and 100%.");
  const patch = {
    scope: input.scope,
    moderator_id: input.scope.includes("moderator") ? input.moderatorId || null : null,
    service_id: input.scope.includes("service") ? input.serviceId || null : null,
    service_name: input.scope.includes("service") ? input.serviceName?.trim() || null : null,
    max_discount_pct: input.maxDiscountPct,
    active: input.active,
    effective_from: input.effectiveFrom || null,
    effective_to: input.effectiveTo || null,
    created_by: a.id,
  };
  const db = supabaseAdmin();
  if (input.id) {
    const { data: before } = await db.from("crm_discount_rules").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_discount_rules").update(patch).eq("id", input.id);
    if (error) throw new FinancialSettingsError(error.message);
    await auditSetting({ actorId: a.id, action: "financial.discount_rule_updated", entityType: "discount_rule", entityId: input.id, oldValues: (before ?? {}) as Record<string, unknown>, newValues: patch });
  } else {
    const { data, error } = await db.from("crm_discount_rules").insert(patch).select("id").single();
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create discount rule.");
    await auditSetting({ actorId: a.id, action: "financial.discount_rule_created", entityType: "discount_rule", entityId: data.id as string, newValues: patch });
  }
  revalidatePath("/financial/settings");
}

export async function upsertDoctorCompRule(input: {
  id?: string | null;
  doctorId: string;
  doctorName?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  kind: "percentage" | "fixed";
  value: number;
  basis: "quoted_price" | "net_after_consumables";
  active: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}): Promise<void> {
  const a = await actor();
  if (!input.doctorId) throw new FinancialSettingsError("Choose a doctor.");
  if (input.kind === "percentage" && (input.value < 0 || input.value > 100)) throw new FinancialSettingsError("Percentage must be 0-100.");
  const patch = {
    doctor_id: input.doctorId,
    doctor_name: input.doctorName?.trim() || null,
    service_id: input.serviceId || null,
    service_name: input.serviceName?.trim() || null,
    kind: input.kind,
    value: money(input.value),
    basis: input.basis,
    active: input.active,
    effective_from: input.effectiveFrom || null,
    effective_to: input.effectiveTo || null,
    created_by: a.id,
  };
  const db = supabaseAdmin();
  if (input.id) {
    const { data: before } = await db.from("crm_doctor_compensation_rules").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_doctor_compensation_rules").update(patch).eq("id", input.id);
    if (error) throw new FinancialSettingsError(error.message);
    await auditSetting({ actorId: a.id, action: "financial.doctor_comp_rule_updated", entityType: "doctor_compensation_rule", entityId: input.id, oldValues: (before ?? {}) as Record<string, unknown>, newValues: patch });
  } else {
    const { data, error } = await db.from("crm_doctor_compensation_rules").insert(patch).select("id").single();
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create doctor compensation rule.");
    await auditSetting({ actorId: a.id, action: "financial.doctor_comp_rule_created", entityType: "doctor_compensation_rule", entityId: data.id as string, newValues: patch });
  }
  revalidatePath("/financial/settings");
  revalidatePath("/financial");
}

export async function upsertConsumableComponent(input: {
  id?: string | null;
  name: string;
  unitCost: number;
  active: boolean;
}): Promise<void> {
  const a = await actor();
  if (!input.name.trim()) throw new FinancialSettingsError("Consumable name is required.");
  const patch = { name: input.name.trim(), unit_cost: money(input.unitCost), active: input.active, created_by: a.id };
  const db = supabaseAdmin();
  if (input.id) {
    const { data: before } = await db.from("crm_consumable_components").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_consumable_components").update(patch).eq("id", input.id);
    if (error) throw new FinancialSettingsError(error.message);
    await auditSetting({ actorId: a.id, action: "financial.consumable_component_updated", entityType: "consumable_component", entityId: input.id, oldValues: (before ?? {}) as Record<string, unknown>, newValues: patch });
  } else {
    const { data, error } = await db.from("crm_consumable_components").insert(patch).select("id").single();
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create consumable.");
    await auditSetting({ actorId: a.id, action: "financial.consumable_component_created", entityType: "consumable_component", entityId: data.id as string, newValues: patch });
  }
  revalidatePath("/financial/settings");
}

export async function upsertServiceConsumableDefault(input: {
  serviceId?: string | null;
  serviceName: string;
  description: string;
  quantity: number;
  unitCost: number;
  active: boolean;
}): Promise<void> {
  const a = await actor();
  if (!input.serviceName.trim() || !input.description.trim()) throw new FinancialSettingsError("Service and consumable are required.");
  const patch = {
    service_id: input.serviceId || null,
    service_name: input.serviceName.trim(),
    description: input.description.trim(),
    quantity: input.quantity || 1,
    unit_cost: money(input.unitCost),
    active: input.active,
    created_by: a.id,
  };
  const { data, error } = await supabaseAdmin().from("crm_service_consumable_defaults").insert(patch).select("id").single();
  if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create service consumable default.");
  await auditSetting({ actorId: a.id, action: "financial.service_consumable_default_created", entityType: "service_consumable_default", entityId: data.id as string, newValues: patch });
  revalidatePath("/financial/settings");
}

export type FinancialRuleTarget = { id: string | null; name: string };
export type DuplicateRuleResult = { created: number; skipped: number };

function sameNullable(a: unknown, b: unknown): boolean {
  return String(a ?? "") === String(b ?? "");
}

function ensureDuplicateSize(size: number): void {
  if (size < 1) throw new FinancialSettingsError("Choose at least one destination.");
  if (size > 200) throw new FinancialSettingsError("Choose 200 destinations or fewer at a time.");
}

export async function duplicateServiceConsumableDefault(
  sourceId: string,
  targets: FinancialRuleTarget[],
): Promise<DuplicateRuleResult> {
  const a = await actor();
  ensureDuplicateSize(targets.length);
  const db = supabaseAdmin();
  const [{ data: source, error: sourceError }, { data: existing, error: existingError }] = await Promise.all([
    db.from("crm_service_consumable_defaults").select("*").eq("id", sourceId).maybeSingle(),
    db.from("crm_service_consumable_defaults").select("service_id,service_name,description"),
  ]);
  if (sourceError || !source) throw new FinancialSettingsError(sourceError?.message ?? "Consumable rule not found.");
  if (existingError) throw new FinancialSettingsError(existingError.message);

  const rows = targets
    .filter((target, index, all) => target.name.trim() && all.findIndex((item) => sameNullable(item.id, target.id) && item.name === target.name) === index)
    .filter((target) => !sameNullable(target.id, source.service_id) || target.name !== source.service_name)
    .filter((target) => !(existing ?? []).some((row) => sameNullable(row.service_id, target.id) && row.service_name === target.name && row.description === source.description))
    .map((target) => ({
      service_id: target.id,
      service_name: target.name.trim(),
      component_id: source.component_id,
      description: source.description,
      quantity: source.quantity,
      unit_cost: source.unit_cost,
      active: source.active,
      created_by: a.id,
    }));
  if (rows.length) {
    const { data, error } = await db.from("crm_service_consumable_defaults").insert(rows).select("id");
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not duplicate consumable rules.");
    await Promise.all(data.map((row, index) => auditSetting({ actorId: a.id, action: "financial.service_consumable_default_duplicated", entityType: "service_consumable_default", entityId: row.id as string, newValues: { ...rows[index], source_id: sourceId } })));
  }
  revalidatePath("/financial/settings");
  return { created: rows.length, skipped: targets.length - rows.length };
}

export async function duplicateDiscountRule(input: {
  sourceId: string;
  moderators: Array<{ id: string; name: string }>;
  services: FinancialRuleTarget[];
}): Promise<DuplicateRuleResult> {
  const a = await actor();
  if (!input.moderators.length && !input.services.length) throw new FinancialSettingsError("Choose at least one moderator or service.");
  const combinations = Math.max(1, input.moderators.length) * Math.max(1, input.services.length);
  ensureDuplicateSize(combinations);
  const db = supabaseAdmin();
  const [{ data: source, error: sourceError }, { data: existing, error: existingError }] = await Promise.all([
    db.from("crm_discount_rules").select("*").eq("id", input.sourceId).maybeSingle(),
    db.from("crm_discount_rules").select("scope,moderator_id,service_id,service_name,effective_from,effective_to"),
  ]);
  if (sourceError || !source) throw new FinancialSettingsError(sourceError?.message ?? "Discount rule not found.");
  if (existingError) throw new FinancialSettingsError(existingError.message);
  const moderators = input.moderators.length ? input.moderators : [{ id: null, name: "" }];
  const services = input.services.length ? input.services : [{ id: null, name: "" }];
  const candidates = moderators.flatMap((moderator) => services.map((service) => {
    const scope = moderator.id && (service.id || service.name) ? "moderator_service" : moderator.id ? "moderator" : "service";
    return {
      scope,
      moderator_id: moderator.id,
      service_id: service.id,
      service_name: service.name || null,
      max_discount_pct: source.max_discount_pct,
      active: source.active,
      effective_from: source.effective_from,
      effective_to: source.effective_to,
      created_by: a.id,
    };
  }));
  const rows = candidates
    .filter((row, index, all) => all.findIndex((item) => item.scope === row.scope && sameNullable(item.moderator_id, row.moderator_id) && sameNullable(item.service_id, row.service_id) && sameNullable(item.service_name, row.service_name)) === index)
    .filter((row) => !(row.scope === source.scope && sameNullable(row.moderator_id, source.moderator_id) && sameNullable(row.service_id, source.service_id) && sameNullable(row.service_name, source.service_name)))
    .filter((row) => !(existing ?? []).some((item) => item.scope === row.scope && sameNullable(item.moderator_id, row.moderator_id) && sameNullable(item.service_id, row.service_id) && sameNullable(item.service_name, row.service_name) && sameNullable(item.effective_from, row.effective_from) && sameNullable(item.effective_to, row.effective_to)));
  if (rows.length) {
    const { data, error } = await db.from("crm_discount_rules").insert(rows).select("id");
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not duplicate discount rules.");
    await Promise.all(data.map((row, index) => auditSetting({ actorId: a.id, action: "financial.discount_rule_duplicated", entityType: "discount_rule", entityId: row.id as string, newValues: { ...rows[index], source_id: input.sourceId } })));
  }
  revalidatePath("/financial/settings");
  return { created: rows.length, skipped: candidates.length - rows.length };
}

export async function duplicateDoctorCompRule(input: {
  sourceId: string;
  doctors: Array<{ id: string; name: string }>;
  services: FinancialRuleTarget[];
}): Promise<DuplicateRuleResult> {
  const a = await actor();
  if (!input.doctors.length && !input.services.length) throw new FinancialSettingsError("Choose at least one doctor or service.");
  const db = supabaseAdmin();
  const [{ data: source, error: sourceError }, { data: existing, error: existingError }] = await Promise.all([
    db.from("crm_doctor_compensation_rules").select("*").eq("id", input.sourceId).maybeSingle(),
    db.from("crm_doctor_compensation_rules").select("doctor_id,service_id,service_name,effective_from,effective_to"),
  ]);
  if (sourceError || !source) throw new FinancialSettingsError(sourceError?.message ?? "Doctor compensation rule not found.");
  if (existingError) throw new FinancialSettingsError(existingError.message);
  const doctors = input.doctors.length ? input.doctors : [{ id: source.doctor_id as string, name: String(source.doctor_name ?? "") }];
  const services = input.services.length ? input.services : [{ id: (source.service_id as string | null) ?? null, name: String(source.service_name ?? "") }];
  ensureDuplicateSize(doctors.length * services.length);
  const candidates = doctors.flatMap((doctor) => services.map((service) => ({
    doctor_id: doctor.id,
    doctor_name: doctor.name || null,
    service_id: service.id,
    service_name: service.name || null,
    kind: source.kind,
    value: source.value,
    basis: source.basis,
    active: source.active,
    effective_from: source.effective_from,
    effective_to: source.effective_to,
    created_by: a.id,
  })));
  const rows = candidates
    .filter((row, index, all) => all.findIndex((item) => item.doctor_id === row.doctor_id && sameNullable(item.service_id, row.service_id) && sameNullable(item.service_name, row.service_name)) === index)
    .filter((row) => !(row.doctor_id === source.doctor_id && sameNullable(row.service_id, source.service_id) && sameNullable(row.service_name, source.service_name)))
    .filter((row) => !(existing ?? []).some((item) => item.doctor_id === row.doctor_id && sameNullable(item.service_id, row.service_id) && sameNullable(item.service_name, row.service_name) && sameNullable(item.effective_from, row.effective_from) && sameNullable(item.effective_to, row.effective_to)));
  if (rows.length) {
    const { data, error } = await db.from("crm_doctor_compensation_rules").insert(rows).select("id");
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not duplicate doctor compensation rules.");
    await Promise.all(data.map((row, index) => auditSetting({ actorId: a.id, action: "financial.doctor_comp_rule_duplicated", entityType: "doctor_compensation_rule", entityId: row.id as string, newValues: { ...rows[index], source_id: input.sourceId } })));
  }
  revalidatePath("/financial/settings");
  return { created: rows.length, skipped: candidates.length - rows.length };
}

export async function upsertExternalCostDefault(input: {
  serviceId?: string | null;
  serviceName: string;
  category: ExternalCostCategory;
  description: string;
  amount: number;
  vendor?: string | null;
  active: boolean;
}): Promise<void> {
  const a = await actor();
  if (!input.serviceName.trim() || !input.description.trim()) throw new FinancialSettingsError("Service and external cost are required.");
  const patch = {
    service_id: input.serviceId || null,
    service_name: input.serviceName.trim(),
    category: input.category,
    description: input.description.trim(),
    amount: money(input.amount),
    vendor: input.vendor?.trim() || null,
    active: input.active,
    created_by: a.id,
  };
  const { data, error } = await supabaseAdmin().from("crm_service_external_cost_defaults").insert(patch).select("id").single();
  if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create external cost default.");
  await auditSetting({ actorId: a.id, action: "financial.external_cost_default_created", entityType: "external_cost_default", entityId: data.id as string, newValues: patch });
  revalidatePath("/financial/settings");
}

export async function addFinancialDoctor(input: {
  nameEn: string;
  nameAr?: string | null;
  titleEn?: string | null;
  specialtyId: string;
  consultationFee?: number | null;
}): Promise<void> {
  await createFinancialDoctor(input);
  revalidatePath("/financial/settings");
}

export async function deleteDiscountRule(id: string): Promise<void> {
  const a = await actor();
  const db = supabaseAdmin();
  const { data: before, error: readError } = await db.from("crm_discount_rules").select("*").eq("id", id).maybeSingle();
  if (readError || !before) throw new FinancialSettingsError(readError?.message ?? "Discount rule not found.");
  const { error } = await db.from("crm_discount_rules").delete().eq("id", id);
  if (error) throw new FinancialSettingsError(error.message);
  await auditSetting({ actorId: a.id, action: "financial.discount_rule_deleted", entityType: "discount_rule", entityId: id, oldValues: before as Record<string, unknown> });
}

export async function upsertBundle(input: {
  id?: string | null;
  name: string;
  specialtyId?: string | null;
  specialtyName?: string | null;
  bundleType: "bundle" | "package" | "addon";
  price: number;
  currency?: string;
  startsOn?: string | null;
  expiresOn?: string | null;
  active: boolean;
}): Promise<void> {
  const a = await actor();
  if (!input.name.trim()) throw new FinancialSettingsError("Bundle name is required.");
  const patch = {
    name: input.name.trim(), specialty_id: input.specialtyId || null,
    specialty_name: input.specialtyName?.trim() || null, bundle_type: input.bundleType,
    price: money(input.price), currency: input.currency?.trim() || "EGP",
    starts_on: input.startsOn || null, expires_on: input.expiresOn || null,
    active: input.active, created_by: a.id,
  };
  const db = supabaseAdmin();
  if (input.id) {
    const { data: before } = await db.from("crm_financial_bundles").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_financial_bundles").update(patch).eq("id", input.id);
    if (error) throw new FinancialSettingsError(error.message);
    await auditSetting({ actorId: a.id, action: "financial.bundle_updated", entityType: "financial_bundle", entityId: input.id, oldValues: (before ?? {}) as Record<string, unknown>, newValues: patch });
  } else {
    const { data, error } = await db.from("crm_financial_bundles").insert(patch).select("id").single();
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create bundle.");
    await auditSetting({ actorId: a.id, action: "financial.bundle_created", entityType: "financial_bundle", entityId: data.id as string, newValues: patch });
  }
}

export async function addBundleComponent(input: { bundleId: string; serviceId: string | null; serviceName: string; quantity: number; doctorId: string; doctorName: string; compensationKind: "percentage" | "fixed"; compensationValue: number; compensationBasis: "quoted_price" | "net_after_consumables" }): Promise<void> {
  const a = await actor();
  if (!input.bundleId || !input.serviceName || !input.doctorId || !input.doctorName) throw new FinancialSettingsError("Choose a bundle, service, and treating doctor.");
  if (input.compensationValue < 0 || (input.compensationKind === "percentage" && input.compensationValue > 100)) throw new FinancialSettingsError("Compensation value is outside the allowed range.");
  const row = { bundle_id: input.bundleId, service_id: input.serviceId, service_name: input.serviceName, quantity: Math.max(0.01, input.quantity), doctor_id: input.doctorId, doctor_name: input.doctorName, compensation_kind: input.compensationKind, compensation_value: money(input.compensationValue), compensation_basis: input.compensationBasis };
  const { data, error } = await supabaseAdmin().from("crm_financial_bundle_components").insert(row).select("id").single();
  if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not add bundle service.");
  await auditSetting({ actorId: a.id, action: "financial.bundle_component_created", entityType: "financial_bundle_component", entityId: data.id as string, newValues: row });
}

export async function upsertAddonRule(input: {
  triggerServiceId?: string | null;
  triggerServiceName: string;
  addonServiceId?: string | null;
  addonServiceName: string;
  addonPrice: number;
  redeemWithinDays: number;
  active: boolean;
}): Promise<void> {
  const a = await actor();
  if (!input.triggerServiceName || !input.addonServiceName) throw new FinancialSettingsError("Choose both services.");
  const patch = {
    trigger_service_id: input.triggerServiceId || null, trigger_service_name: input.triggerServiceName,
    addon_service_id: input.addonServiceId || null, addon_service_name: input.addonServiceName,
    addon_price: money(input.addonPrice), redeem_within_days: Math.max(0, Math.trunc(input.redeemWithinDays)),
    anchor: "procedure_date", active: input.active, created_by: a.id,
  };
  const { data, error } = await supabaseAdmin().from("crm_service_addon_rules").insert(patch).select("id").single();
  if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create add-on rule.");
  await auditSetting({ actorId: a.id, action: "financial.addon_rule_created", entityType: "service_addon_rule", entityId: data.id as string, newValues: patch });
}

export async function upsertPaymentMethod(input: {
  id?: string | null; methodKey: string; displayName: string; ledgerMethod: string;
  displayOrder: number; active: boolean;
}): Promise<void> {
  const a = await actor();
  if (!/^[a-z0-9_]+$/.test(input.methodKey)) throw new FinancialSettingsError("Method key may contain lowercase letters, numbers, and underscores only.");
  if (!input.displayName.trim()) throw new FinancialSettingsError("Display name is required.");
  const patch = { method_key: input.methodKey, display_name: input.displayName.trim(), ledger_method: input.ledgerMethod, display_order: input.displayOrder, active: input.active, created_by: a.id };
  const db = supabaseAdmin();
  if (input.id) {
    const { data: before } = await db.from("crm_payment_method_settings").select("*").eq("id", input.id).maybeSingle();
    const { error } = await db.from("crm_payment_method_settings").update(patch).eq("id", input.id);
    if (error) throw new FinancialSettingsError(error.message);
    await auditSetting({ actorId: a.id, action: "financial.payment_method_updated", entityType: "payment_method", entityId: input.id, oldValues: (before ?? {}) as Record<string, unknown>, newValues: patch });
  } else {
    const { data, error } = await db.from("crm_payment_method_settings").insert(patch).select("id").single();
    if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create payment method.");
    await auditSetting({ actorId: a.id, action: "financial.payment_method_created", entityType: "payment_method", entityId: data.id as string, newValues: patch });
  }
}

export async function upsertStaffCommission(input: {
  moderatorId?: string | null; doctorId?: string | null; serviceId?: string | null;
  serviceName?: string | null; specialtyId?: string | null; commissionPct: number; active: boolean;
}): Promise<void> {
  const a = await actor();
  if (input.commissionPct < 0 || input.commissionPct > 100) throw new FinancialSettingsError("Commission must be between 0 and 100%.");
  if (!input.moderatorId && !input.doctorId) throw new FinancialSettingsError("Choose a moderator or doctor.");
  const patch = { moderator_id: input.moderatorId || null, doctor_id: input.doctorId || null, service_id: input.serviceId || null, service_name: input.serviceName || null, specialty_id: input.specialtyId || null, commission_pct: input.commissionPct, active: input.active, created_by: a.id };
  const { data, error } = await supabaseAdmin().from("crm_staff_commission_rules").insert(patch).select("id").single();
  if (error || !data) throw new FinancialSettingsError(error?.message ?? "Could not create commission rule.");
  await auditSetting({ actorId: a.id, action: "financial.staff_commission_created", entityType: "staff_commission_rule", entityId: data.id as string, newValues: patch });
}

export async function setFinancialSettingActive(table: "crm_service_consumable_defaults" | "crm_service_external_cost_defaults" | "crm_financial_bundles" | "crm_service_addon_rules" | "crm_payment_method_settings" | "crm_staff_commission_rules", id: string, active: boolean): Promise<void> {
  const a = await actor();
  const { data: before, error: readError } = await supabaseAdmin().from(table).select("*").eq("id", id).maybeSingle();
  if (readError || !before) throw new FinancialSettingsError(readError?.message ?? "Setting not found.");
  const { error } = await supabaseAdmin().from(table).update({ active }).eq("id", id);
  if (error) throw new FinancialSettingsError(error.message);
  await auditSetting({ actorId: a.id, action: "financial.setting_state_changed", entityType: table, entityId: id, oldValues: before as Record<string, unknown>, newValues: { active } });
}
