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
