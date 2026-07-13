"use server";

import {
  BookingError,
  createBlockedTime,
  deleteBlockedTime,
  updateScheduleTemplate,
} from "@/lib/booking/service";

export interface SchedulingActionState {
  ok: boolean;
  error?: string;
}

const OK: SchedulingActionState = { ok: true };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function actionError(error: unknown): SchedulingActionState {
  if (error instanceof BookingError && !error.message.includes(":")) {
    return { ok: false, error: error.message };
  }
  console.error("scheduling mutation failed", error);
  return { ok: false, error: "Scheduling change failed." };
}

export async function updateScheduleTemplateAction(
  _prev: SchedulingActionState,
  formData: FormData,
): Promise<SchedulingActionState> {
  try {
    await updateScheduleTemplate({
      scheduleId: str(formData, "scheduleId"),
      active: formData.get("active") === "on",
      startTime: str(formData, "startTime"),
      endTime: str(formData, "endTime"),
      firstComeFirstServe: formData.get("firstComeFirstServe") === "on",
      firstComeCapacity: Number(str(formData, "firstComeCapacity") || 1),
    });
    return OK;
  } catch (error) {
    return actionError(error);
  }
}

export async function createBlockedTimeAction(
  _prev: SchedulingActionState,
  formData: FormData,
): Promise<SchedulingActionState> {
  try {
    await createBlockedTime({
      date: str(formData, "date"),
      startTime: str(formData, "startTime") || null,
      endTime: str(formData, "endTime") || null,
      doctorId: str(formData, "doctorId") || null,
      branchId: str(formData, "branchId") || null,
      fullDay: formData.get("fullDay") === "on",
      reason: str(formData, "reason"),
    });
    return OK;
  } catch (error) {
    return actionError(error);
  }
}

export async function deleteBlockedTimeAction(
  _prev: SchedulingActionState,
  formData: FormData,
): Promise<SchedulingActionState> {
  try {
    await deleteBlockedTime(str(formData, "id"));
    return OK;
  } catch (error) {
    return actionError(error);
  }
}
