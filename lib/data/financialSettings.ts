import "server-only";
import { financialDoctorCatalog } from "@/lib/booking/service";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { ExternalCostCategory, PaymentMethod } from "@/lib/data/financials";

export type FinancialServiceSetting = {
  id: string | null;
  serviceId: string | null;
  serviceName: string;
  serviceCode: string | null;
  specialtyId: string | null;
  specialtyName: string | null;
  specialtyIds: string[];
  basePrice: number;
  currency: string;
  defaultConsumablesCost: number;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type FinancialDiscountRule = {
  id: string;
  scope: "moderator_service" | "moderator" | "service" | "global";
  moderatorId: string | null;
  moderatorName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  maxDiscountPct: number;
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type FinancialDoctorCompRule = {
  id: string;
  doctorId: string;
  doctorName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  kind: "percentage" | "fixed";
  value: number;
  basis: "quoted_price" | "net_after_consumables";
  active: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

export type ConsumableComponentSetting = {
  id: string;
  name: string;
  unitCost: number;
  active: boolean;
};

export type ServiceConsumableDefault = {
  id: string;
  serviceName: string;
  serviceId: string | null;
  description: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  active: boolean;
};

export type ServiceExternalCostDefault = {
  id: string;
  serviceName: string;
  serviceId: string | null;
  category: ExternalCostCategory;
  description: string;
  amount: number;
  vendor: string | null;
  active: boolean;
};

export type FinancialModerator = {
  id: string;
  name: string;
};

export type FinancialBundle = {
  id: string;
  name: string;
  specialtyId: string | null;
  specialtyName: string | null;
  bundleType: "bundle" | "package" | "addon";
  price: number;
  currency: string;
  active: boolean;
  startsOn: string | null;
  expiresOn: string | null;
};

export type AddonRule = {
  id: string;
  triggerServiceName: string;
  addonServiceName: string;
  addonPrice: number;
  redeemWithinDays: number;
  active: boolean;
};

export type PaymentMethodSetting = {
  id: string;
  methodKey: string;
  displayName: string;
  ledgerMethod: PaymentMethod;
  displayOrder: number;
  active: boolean;
};

export type StaffCommissionRule = {
  id: string;
  moderatorId: string | null;
  doctorId: string | null;
  serviceId: string | null;
  serviceName: string | null;
  specialtyId: string | null;
  commissionPct: number;
  active: boolean;
};
export type FinancialBundleComponent = { id: string; bundleId: string; serviceId: string | null; serviceName: string; quantity: number; doctorId: string | null; doctorName: string | null; compensationKind: "percentage" | "fixed" | null; compensationValue: number | null; compensationBasis: "quoted_price" | "net_after_consumables" };

export type FinancialSettingsData = {
  services: FinancialServiceSetting[];
  discountRules: FinancialDiscountRule[];
  doctorCompRules: FinancialDoctorCompRule[];
  consumableComponents: ConsumableComponentSetting[];
  serviceConsumableDefaults: ServiceConsumableDefault[];
  externalCostDefaults: ServiceExternalCostDefault[];
  moderators: FinancialModerator[];
  doctors: Awaited<ReturnType<typeof financialDoctorCatalog>>;
  paymentMethods: PaymentMethod[];
  paymentMethodSettings: PaymentMethodSetting[];
  bundles: FinancialBundle[];
  bundleComponents: FinancialBundleComponent[];
  addonRules: AddonRule[];
  staffCommissionRules: StaffCommissionRule[];
  externalCostCategories: ExternalCostCategory[];
};

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "visa", "instapay", "mobile_wallet", "bank_transfer", "other"];
const EXTERNAL_COST_CATEGORIES: ExternalCostCategory[] = [
  "lab",
  "outside_facility",
  "external_surgeon",
  "anesthetist",
  "imaging",
  "referral_commission",
  "external_provider",
  "other",
];

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function label(row: { name_en?: string | null; name_ar?: string | null }): string {
  return row.name_en?.trim() || row.name_ar?.trim() || "Unnamed";
}

export async function financialSettingsData(): Promise<FinancialSettingsData> {
  const db = supabaseAdmin();
  const [
    doctors,
    serviceSettings,
    discountRules,
    compRules,
    components,
    consumableDefaults,
    externalDefaults,
    moderatorsRes,
    bundlesRes,
    bundleComponentsRes,
    addonRulesRes,
    paymentMethodsRes,
    commissionsRes,
  ] = await Promise.all([
    financialDoctorCatalog(),
    db.from("crm_financial_service_settings").select("*").order("service_name"),
    db.from("crm_discount_rules").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("crm_doctor_compensation_rules").select("*").order("created_at", { ascending: false }).limit(200),
    db.from("crm_consumable_components").select("id,name,unit_cost,active").order("name"),
    db.from("crm_service_consumable_defaults").select("*").order("service_name"),
    db.from("crm_service_external_cost_defaults").select("*").order("service_name"),
    db.from("crm_users").select("id,full_name,email").eq("role", "moderator").eq("is_active", true).order("full_name"),
    db.from("crm_financial_bundles").select("*").order("created_at", { ascending: false }).limit(30),
    db.from("crm_financial_bundle_components").select("*").order("display_order").limit(300),
    db.from("crm_service_addon_rules").select("*").order("created_at", { ascending: false }).limit(30),
    db.from("crm_payment_method_settings").select("*").order("display_order").limit(30),
    db.from("crm_staff_commission_rules").select("*").order("created_at", { ascending: false }),
  ]);

  for (const [name, res] of Object.entries({ serviceSettings, discountRules, compRules, components, moderatorsRes })) {
    if (res.error) throw new Error(`financialSettingsData(${name}): ${res.error.message}`);
  }

  const serviceRows = new Map<string, Record<string, unknown>>();
  for (const row of (serviceSettings.data ?? []) as Record<string, unknown>[]) {
    const key = String(row.service_id ?? row.service_name).toLowerCase();
    if (!serviceRows.has(key)) serviceRows.set(key, row);
  }

  const specialtyName = new Map(doctors.specialties.map((s) => [s.id, s.nameEn] as const));
  const bookingServices = doctors.configured
    ? await bookingServicesForFinance().catch(() => [])
    : [];

  const seen = new Set<string>();
  const services: FinancialServiceSetting[] = [];
  for (const svc of bookingServices) {
    const key = String(svc.id).toLowerCase();
    seen.add(key);
    const setting = serviceRows.get(key) ?? serviceRows.get(svc.nameEn.toLowerCase());
    services.push({
      id: (setting?.id as string | null | undefined) ?? null,
      serviceId: svc.id,
      serviceName: svc.nameEn,
      serviceCode: svc.code,
      specialtyId: svc.specialtyId,
      specialtyName: svc.specialtyId ? specialtyName.get(svc.specialtyId) ?? null : null,
      specialtyIds: (setting?.specialty_ids as string[] | undefined) ?? (svc.specialtyId ? [svc.specialtyId] : []),
      basePrice: num(setting?.base_price ?? svc.fee),
      currency: (setting?.currency as string | undefined) ?? "EGP",
      defaultConsumablesCost: num(setting?.default_consumables_cost),
      active: setting ? Boolean(setting.active) : false,
      effectiveFrom: (setting?.effective_from as string | null | undefined) ?? null,
      effectiveTo: (setting?.effective_to as string | null | undefined) ?? null,
    });
  }
  for (const setting of (serviceSettings.data ?? []) as Record<string, unknown>[]) {
    const key = String(setting.service_id ?? "").toLowerCase();
    if (key && seen.has(key)) continue;
    services.push({
      id: setting.id as string,
      serviceId: (setting.service_id as string | null) ?? null,
      serviceName: setting.service_name as string,
      serviceCode: null,
      specialtyId: null,
      specialtyName: null,
      specialtyIds: (setting.specialty_ids as string[] | null) ?? [],
      basePrice: num(setting.base_price),
      currency: (setting.currency as string | null) ?? "EGP",
      defaultConsumablesCost: num(setting.default_consumables_cost),
      active: Boolean(setting.active),
      effectiveFrom: (setting.effective_from as string | null) ?? null,
      effectiveTo: (setting.effective_to as string | null) ?? null,
    });
  }

  const moderators = ((moderatorsRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[])
    .map((u) => ({ id: u.id, name: u.full_name?.trim() || u.email || "Unnamed user" }));
  const moderatorName = new Map(moderators.map((m) => [m.id, m.name] as const));

  return {
    services,
    doctors,
    moderators,
    discountRules: ((discountRules.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      scope: r.scope as FinancialDiscountRule["scope"],
      moderatorId: (r.moderator_id as string | null) ?? null,
      moderatorName: r.moderator_id ? moderatorName.get(r.moderator_id as string) ?? null : null,
      serviceId: (r.service_id as string | null) ?? null,
      serviceName: (r.service_name as string | null) ?? null,
      maxDiscountPct: num(r.max_discount_pct),
      active: Boolean(r.active),
      effectiveFrom: (r.effective_from as string | null) ?? null,
      effectiveTo: (r.effective_to as string | null) ?? null,
    })),
    doctorCompRules: ((compRules.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      doctorId: r.doctor_id as string,
      doctorName: (r.doctor_name as string | null) ?? null,
      serviceId: (r.service_id as string | null) ?? null,
      serviceName: (r.service_name as string | null) ?? null,
      kind: r.kind as FinancialDoctorCompRule["kind"],
      value: num(r.value),
      basis: r.basis as FinancialDoctorCompRule["basis"],
      active: Boolean(r.active),
      effectiveFrom: (r.effective_from as string | null) ?? null,
      effectiveTo: (r.effective_to as string | null) ?? null,
    })),
    consumableComponents: ((components.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      unitCost: num(r.unit_cost),
      active: Boolean(r.active),
    })),
    serviceConsumableDefaults: ((consumableDefaults.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      serviceId: (r.service_id as string | null) ?? null,
      serviceName: r.service_name as string,
      description: r.description as string,
      quantity: num(r.quantity),
      unitCost: num(r.unit_cost),
      totalCost: num(r.total_cost),
      active: Boolean(r.active),
    })),
    externalCostDefaults: ((externalDefaults.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      serviceId: (r.service_id as string | null) ?? null,
      serviceName: r.service_name as string,
      category: r.category as ExternalCostCategory,
      description: r.description as string,
      amount: num(r.amount),
      vendor: (r.vendor as string | null) ?? null,
      active: Boolean(r.active),
    })),
    paymentMethods: PAYMENT_METHODS,
    paymentMethodSettings: ((paymentMethodsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      methodKey: r.method_key as string,
      displayName: r.display_name as string,
      ledgerMethod: r.ledger_method as PaymentMethod,
      displayOrder: num(r.display_order),
      active: Boolean(r.active),
    })),
    bundles: ((bundlesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      specialtyId: (r.specialty_id as string | null) ?? null,
      specialtyName: (r.specialty_name as string | null) ?? null,
      bundleType: r.bundle_type as FinancialBundle["bundleType"],
      price: num(r.price),
      currency: (r.currency as string) ?? "EGP",
      active: Boolean(r.active),
      startsOn: (r.starts_on as string | null) ?? null,
      expiresOn: (r.expires_on as string | null) ?? null,
    })),
    bundleComponents: ((bundleComponentsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id as string, bundleId: r.bundle_id as string, serviceId: (r.service_id as string | null) ?? null, serviceName: r.service_name as string, quantity: num(r.quantity), doctorId: (r.doctor_id as string | null) ?? null, doctorName: (r.doctor_name as string | null) ?? null, compensationKind: (r.compensation_kind as "percentage" | "fixed" | null) ?? null, compensationValue: r.compensation_value == null ? null : num(r.compensation_value), compensationBasis: (r.compensation_basis as "quoted_price" | "net_after_consumables") ?? "quoted_price" })),
    addonRules: ((addonRulesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      triggerServiceName: r.trigger_service_name as string,
      addonServiceName: r.addon_service_name as string,
      addonPrice: num(r.addon_price),
      redeemWithinDays: num(r.redeem_within_days),
      active: Boolean(r.active),
    })),
    staffCommissionRules: ((commissionsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      moderatorId: (r.moderator_id as string | null) ?? null,
      doctorId: (r.doctor_id as string | null) ?? null,
      serviceId: (r.service_id as string | null) ?? null,
      serviceName: (r.service_name as string | null) ?? null,
      specialtyId: (r.specialty_id as string | null) ?? null,
      commissionPct: num(r.commission_pct),
      active: Boolean(r.active),
    })),
    externalCostCategories: EXTERNAL_COST_CATEGORIES,
  };
}

async function bookingServicesForFinance(): Promise<Array<{
  id: string;
  nameEn: string;
  specialtyId: string | null;
  fee: number | null;
  code: string | null;
}>> {
  const { bookingDb } = await import("@/lib/booking/client");
  const { data, error } = await bookingDb()
    .from("services")
    .select("id,name_en,name_ar,specialty_id,fee")
    .order("display_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id: string; name_en: string | null; name_ar: string | null; specialty_id: string | null; fee: number | null }>)
    .map((r) => ({
      id: r.id,
      nameEn: label(r),
      specialtyId: r.specialty_id,
      fee: r.fee,
      code: null,
    }));
}
