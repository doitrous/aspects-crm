"use server";

import {
  CrmSchedulingError,
  deleteCrmRoom,
  duplicateCrmSchedule,
  saveCrmClosure,
  saveCrmRoom,
  saveCrmSchedule,
  saveCrmScheduleException,
  saveCrmTimeOff,
  saveDoctorBranchAssignments,
  syncCrmRoomsFromAdmin,
  type RoomSyncItem,
} from "@/lib/scheduling/crm";

export interface SchedulingActionState {
  ok: boolean;
  error?: string;
  message?: string;
  roomSync?: {
    added: RoomSyncItem[];
    updated: RoomSyncItem[];
    deleted: RoomSyncItem[];
    retained: RoomSyncItem[];
    totalAdminRooms: number;
  };
}
const OK: SchedulingActionState = { ok: true };
const str = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const state = (error: unknown): SchedulingActionState => ({ ok: false, error: error instanceof CrmSchedulingError ? error.message : "CRM scheduling change failed." });

export async function saveScheduleAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try { await saveCrmSchedule({ id: str(data,"id") || undefined, doctorId: str(data,"doctorId"), branchId: str(data,"branchId"), roomId: str(data,"roomId"), dayOfWeek: Number(str(data,"dayOfWeek")), startTime: str(data,"startTime"), endTime: str(data,"endTime"), slotDurationMinutes: Number(str(data,"slotDurationMinutes") || 20), firstComeFirstServe: data.get("firstComeFirstServe") === "on", firstComeCapacity: Number(str(data,"firstComeCapacity") || 10), effectiveFrom: str(data,"effectiveFrom"), effectiveTo: str(data,"effectiveTo"), active: data.get("active") === "on", showOnBookingWebsite: data.get("showOnBookingWebsite") === "on" }); return { ok: true, message: "Shared schedule saved for CRM and online booking." }; } catch (error) { return state(error); }
}
export async function duplicateScheduleAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try {
    const result = await duplicateCrmSchedule({ scheduleId: str(data, "scheduleId"), doctorIds: data.getAll("doctorIds").map(String), daysOfWeek: data.getAll("daysOfWeek").map(Number) });
    return { ok: true, message: `${result.created} schedule${result.created === 1 ? "" : "s"} duplicated.${result.skipped.length ? ` ${result.skipped.length} target${result.skipped.length === 1 ? " was" : "s were"} skipped: ${result.skipped.join(", ")}.` : ""}` };
  } catch (error) { return state(error); }
}
export async function saveRoomAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try { await saveCrmRoom({ id: str(data,"id") || undefined, branchId: str(data,"branchId"), nameEn: str(data,"nameEn"), nameAr: str(data,"nameAr"), roomType: str(data,"roomType"), active: data.get("active") === "on" }); return OK; } catch (error) { return state(error); }
}
export async function deleteRoomAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try { await deleteCrmRoom(str(data,"id")); return OK; } catch (error) { return state(error); }
}
export async function syncRoomsFromAdminAction(previous: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  void previous; void data;
  try {
    const result = await syncCrmRoomsFromAdmin();
    return {
      ok: true,
      message: `${result.totalAdminRooms} shared clinic rooms refreshed. CRM and Admin now read these same room records; no copy or deletion was required.`,
      roomSync: result,
    };
  } catch (error) { return state(error); }
}
export async function saveClosureAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try { await saveCrmClosure({ title: str(data,"title"), scope: str(data,"scope"), branchId: str(data,"branchId"), roomId: str(data,"roomId"), startsAt: str(data,"startsAt"), endsAt: str(data,"endsAt"), notes: str(data,"notes"), active: data.get("active") === "on" }); return OK; } catch (error) { return state(error); }
}
export async function saveScheduleExceptionAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try { await saveCrmScheduleException({ doctorId: str(data,"doctorId"), branchId: str(data,"branchId"), roomId: str(data,"roomId"), exceptionDate: str(data,"exceptionDate"), startTime: str(data,"startTime"), endTime: str(data,"endTime"), exceptionType: str(data,"exceptionType"), reason: str(data,"reason"), active: data.get("active") === "on" }); return OK; } catch (error) { return state(error); }
}
export async function saveTimeOffAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try { await saveCrmTimeOff({ doctorId: str(data,"doctorId"), branchId: str(data,"branchId"), startsAt: str(data,"startsAt"), endsAt: str(data,"endsAt"), reason: str(data,"reason"), notes: str(data,"notes"), status: str(data,"status") || "approved" }); return OK; } catch (error) { return state(error); }
}
export async function saveBranchAssignmentsAction(_: SchedulingActionState, data: FormData): Promise<SchedulingActionState> {
  try {
    const result = await saveDoctorBranchAssignments({ doctorId: str(data, "doctorId"), branchIds: data.getAll("branchIds").map(String) });
    return { ok: true, message: `${result.doctorName} is assigned to ${result.branchNames.join(", ")}.` };
  } catch (error) { return state(error); }
}
