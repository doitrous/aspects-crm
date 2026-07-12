"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/permissions";
import { ActorError } from "@/lib/data/actor";
import {
  AuditorError,
  generateAuditReport,
  saveMetricOverride,
  finalizeAuditReport,
  reopenAuditReport,
} from "@/lib/data/auditor";

export interface AuditorActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

function fail(err: unknown): AuditorActionState {
  if (err instanceof AuditorError || err instanceof ActorError) return { ok: false, error: err.message };
  if (err instanceof PermissionError)
    return { ok: false, error: "You are not authorized to run auditor reports." };
  console.error("auditor report action failed", err);
  return { ok: false, error: "The report could not be saved. Please retry; if it continues, check that the latest reporting migration is applied." };
}

function refresh(date: string) {
  revalidatePath("/auditor");
  revalidatePath(`/auditor?date=${date}`);
  revalidatePath("/reports");
}

export async function generateReportAction(
  _prev: AuditorActionState,
  fd: FormData,
): Promise<AuditorActionState> {
  const date = String(fd.get("date") ?? "").trim();
  try {
    await generateAuditReport(date);
  } catch (err) {
    return fail(err);
  }
  refresh(date);
  return { ok: true, message: "Report generated." };
}

export async function saveOverrideAction(
  _prev: AuditorActionState,
  fd: FormData,
): Promise<AuditorActionState> {
  const date = String(fd.get("date") ?? "").trim();
  const metricKey = String(fd.get("metricKey") ?? "").trim();
  const rawValue = String(fd.get("value") ?? "").trim();
  const reason = String(fd.get("reason") ?? "");
  try {
    await saveMetricOverride({
      date,
      metricKey,
      value: rawValue === "" ? null : Number(rawValue),
      reason,
    });
  } catch (err) {
    return fail(err);
  }
  refresh(date);
  return { ok: true, message: rawValue === "" ? "Override cleared." : "Override saved." };
}

export async function finalizeReportAction(
  _prev: AuditorActionState,
  fd: FormData,
): Promise<AuditorActionState> {
  const date = String(fd.get("date") ?? "").trim();
  try {
    await finalizeAuditReport(date);
  } catch (err) {
    return fail(err);
  }
  refresh(date);
  return { ok: true, message: "Report finalized." };
}

export async function reopenReportAction(
  _prev: AuditorActionState,
  fd: FormData,
): Promise<AuditorActionState> {
  const date = String(fd.get("date") ?? "").trim();
  try {
    await reopenAuditReport(date);
  } catch (err) {
    return fail(err);
  }
  refresh(date);
  return { ok: true, message: "Report reopened." };
}
