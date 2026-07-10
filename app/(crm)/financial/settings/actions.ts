"use server";

import { revalidatePath } from "next/cache";
import { ActorError } from "@/lib/data/actor";
import { PermissionError } from "@/lib/auth/permissions";
import {
  addFinancialDoctor,
  FinancialSettingsError,
  upsertConsumableComponent,
  upsertDiscountRule,
  upsertDoctorCompRule,
  upsertExternalCostDefault,
  upsertServiceConsumableDefault,
  upsertServicePrice,
} from "@/lib/data/financialSettingsMutations";
import type { ExternalCostCategory } from "@/lib/data/financials";

export type FinancialSettingsActionState = { ok?: string; error?: string };

function str(fd: FormData, k: string): string {
  return String(fd.get(k) ?? "").trim();
}
function num(fd: FormData, k: string): number {
  const n = Number(str(fd, k));
  return Number.isFinite(n) ? n : 0;
}
function bool(fd: FormData, k: string): boolean {
  const v = fd.get(k);
  return v === "on" || v === "true" || v === "1";
}
function serviceRef(fd: FormData): { serviceId: string | null; serviceName: string } {
  const raw = str(fd, "serviceRef");
  if (!raw) return { serviceId: str(fd, "serviceId") || null, serviceName: str(fd, "serviceName") };
  const [id, ...rest] = raw.split("::");
  return { serviceId: id || null, serviceName: rest.join("::") || str(fd, "serviceName") };
}
function fail(err: unknown): FinancialSettingsActionState {
  if (err instanceof FinancialSettingsError || err instanceof ActorError) return { error: err.message };
  if (err instanceof PermissionError) return { error: "You are not authorized to manage financial settings." };
  console.error("financial settings mutation failed", err);
  return { error: "The financial setting could not be saved. Please try again." };
}
function done(message: string): FinancialSettingsActionState {
  revalidatePath("/financial/settings");
  revalidatePath("/financial");
  return { ok: message };
}

export async function upsertServicePriceAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    await upsertServicePrice({
      id: str(fd, "id") || null,
      serviceId: str(fd, "serviceId") || null,
      serviceName: str(fd, "serviceName"),
      basePrice: num(fd, "basePrice"),
      currency: str(fd, "currency") || "EGP",
      defaultConsumablesCost: num(fd, "defaultConsumablesCost"),
      active: bool(fd, "active"),
      effectiveFrom: str(fd, "effectiveFrom") || null,
      effectiveTo: str(fd, "effectiveTo") || null,
    });
  } catch (err) {
    return fail(err);
  }
  return done("Service pricing saved.");
}

export async function upsertDiscountRuleAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    const svc = serviceRef(fd);
    await upsertDiscountRule({
      id: str(fd, "id") || null,
      scope: str(fd, "scope") as "moderator_service" | "moderator" | "service" | "global",
      moderatorId: str(fd, "moderatorId") || null,
      serviceId: svc.serviceId,
      serviceName: svc.serviceName || null,
      maxDiscountPct: num(fd, "maxDiscountPct"),
      active: bool(fd, "active"),
      effectiveFrom: str(fd, "effectiveFrom") || null,
      effectiveTo: str(fd, "effectiveTo") || null,
    });
  } catch (err) {
    return fail(err);
  }
  return done("Discount rule saved.");
}

export async function upsertDoctorCompRuleAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    const svc = serviceRef(fd);
    await upsertDoctorCompRule({
      id: str(fd, "id") || null,
      doctorId: str(fd, "doctorId"),
      doctorName: str(fd, "doctorName") || null,
      serviceId: svc.serviceId,
      serviceName: svc.serviceName || null,
      kind: str(fd, "kind") as "percentage" | "fixed",
      value: num(fd, "value"),
      basis: str(fd, "basis") as "quoted_price" | "net_after_consumables",
      active: bool(fd, "active"),
      effectiveFrom: str(fd, "effectiveFrom") || null,
      effectiveTo: str(fd, "effectiveTo") || null,
    });
  } catch (err) {
    return fail(err);
  }
  return done("Doctor compensation rule saved.");
}

export async function upsertConsumableComponentAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    await upsertConsumableComponent({
      id: str(fd, "id") || null,
      name: str(fd, "name"),
      unitCost: num(fd, "unitCost"),
      active: bool(fd, "active"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Consumable saved.");
}

export async function upsertServiceConsumableDefaultAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    const svc = serviceRef(fd);
    await upsertServiceConsumableDefault({
      serviceId: svc.serviceId,
      serviceName: svc.serviceName,
      description: str(fd, "description"),
      quantity: num(fd, "quantity") || 1,
      unitCost: num(fd, "unitCost"),
      active: bool(fd, "active"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("Service consumable default added.");
}

export async function upsertExternalCostDefaultAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    const svc = serviceRef(fd);
    await upsertExternalCostDefault({
      serviceId: svc.serviceId,
      serviceName: svc.serviceName,
      category: str(fd, "category") as ExternalCostCategory,
      description: str(fd, "description"),
      amount: num(fd, "amount"),
      vendor: str(fd, "vendor") || null,
      active: bool(fd, "active"),
    });
  } catch (err) {
    return fail(err);
  }
  return done("External cost default added.");
}

export async function addFinancialDoctorAction(
  _prev: FinancialSettingsActionState,
  fd: FormData,
): Promise<FinancialSettingsActionState> {
  try {
    await addFinancialDoctor({
      nameEn: str(fd, "nameEn"),
      nameAr: str(fd, "nameAr") || null,
      titleEn: str(fd, "titleEn") || null,
      specialtyId: str(fd, "specialtyId"),
      consultationFee: str(fd, "consultationFee") ? num(fd, "consultationFee") : null,
    });
  } catch (err) {
    return fail(err);
  }
  return done("Doctor added to Admin catalog as inactive/not bookable.");
}
