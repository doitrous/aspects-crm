import "server-only";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth/permissions";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import { writeActor } from "@/lib/data/actor";
import { parseWorkingHours, type CapacityService, type WorkingHours } from "@/lib/scheduling/capacity";
import { supabaseAdmin } from "@/lib/supabase/server";

export class CrmSchedulingError extends Error {}

export interface CatalogItem { id: string; nameEn: string; nameAr?: string; active: boolean; branchId?: string; roomType?: string; specialtyId?: string }
export interface CrmScheduleRow {
  id: string; doctorId: string; doctorName: string; branchId: string; branchName: string; roomId: string | null;
  roomName: string | null; dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number;
  firstComeFirstServe: boolean; firstComeCapacity: number; effectiveFrom: string | null; effectiveTo: string | null; active: boolean;
}
export interface CrmClosureRow { id: string; title: string; scope: string; branchName: string | null; roomName: string | null; startsAt: string; endsAt: string; notes: string | null; active: boolean }
export interface CrmTimeOffRow { id: string; doctorName: string; branchName: string | null; startsAt: string; endsAt: string; reason: string; notes: string | null; status: string }
export interface CrmScheduleExceptionRow { id: string; doctorName: string; branchName: string; roomName: string | null; exceptionDate: string; startTime: string | null; endTime: string | null; exceptionType: string; reason: string | null; active: boolean }
export interface DoctorBranchAssignment { doctorId: string; branchId: string }
export interface RoomSyncItem { id: string; name: string; branchName: string }
export interface RoomSyncResult {
  added: RoomSyncItem[];
  updated: RoomSyncItem[];
  deleted: RoomSyncItem[];
  retained: RoomSyncItem[];
  totalAdminRooms: number;
}
export interface CrmSchedulingSnapshot {
  catalogConfigured: boolean; migrationReady: boolean; doctors: CatalogItem[]; branches: CatalogItem[]; rooms: CatalogItem[];
  schedules: CrmScheduleRow[]; exceptions: CrmScheduleExceptionRow[]; closures: CrmClosureRow[]; timeOff: CrmTimeOffRow[];
  branchAssignments: DoctorBranchAssignment[];
  services: CapacityService[];
  workingHours: WorkingHours;
}
type RoomDb = { id:string; name_en:string; name_ar:string|null; room_type:string; is_active:boolean; branch_id:string };
type ScheduleDb = { id:string; doctor_id:string; doctor_name:string; branch_id:string; branch_name:string; day_of_week:number; start_time:string; end_time:string; slot_duration_minutes:number; first_come_first_serve:boolean; first_come_capacity:number; effective_from:string|null; effective_to:string|null; is_active:boolean; crm_schedule_room_assignments?:Array<{room_id:string;room_name:string}> };
type ClosureDb = { id:string; title:string; scope:string; branch_name:string|null; room_name:string|null; starts_at:string; ends_at:string; notes:string|null; is_active:boolean };
type TimeOffDb = { id:string; doctor_name:string; branch_name:string|null; starts_at:string; ends_at:string; reason:string; notes:string|null; status:string };
type ExceptionDb = { id:string; doctor_name:string; branch_name:string; room_name:string|null; exception_date:string; start_time:string|null; end_time:string|null; exception_type:string; reason:string|null; is_active:boolean };

const hhmm = (value: string) => value.slice(0, 5);
const cleanTime = (value: string) => {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new CrmSchedulingError("Enter a valid time.");
  return value;
};
const tableMissing = (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205";

async function catalog() {
  if (!bookingConfigured()) return { configured: false, doctors: [], branches: [], rooms: [], branchAssignments: [], services: [], workingHours: parseWorkingHours(null) };
  const db = bookingDb();
  const [doctors, branches, branchAssignments, services, workingHours] = await Promise.all([
    db.from("doctors").select("id,name_en,name_ar,is_active,specialty_id").order("display_order"),
    db.from("branches").select("id,name_en,name_ar,is_active").order("display_order"),
    db.from("doctor_branch_assignments").select("doctor_id,branch_id,is_active").eq("is_active", true),
    db.from("services").select("id,name_en,duration_minutes,specialty_id,doctor_id,service_doctors(doctor_id)").eq("is_active", true),
    db.from("clinic_settings").select("value").eq("key", "working_hours_en").maybeSingle<{ value: string }>(),
  ]);
  for (const response of [doctors, branches, branchAssignments, services, workingHours]) {
    if (response.error) throw new CrmSchedulingError(`Could not read booking catalog: ${response.error.message}`);
  }
  const item = (row: { id: string; name_en: string; name_ar?: string | null; is_active?: boolean | null; branch_id?: string; specialty_id?: string }) => ({
    id: row.id, nameEn: row.name_en, nameAr: row.name_ar ?? undefined, active: row.is_active !== false, branchId: row.branch_id, specialtyId: row.specialty_id,
  });
  type ServiceRow = { id:string; name_en:string; duration_minutes:number; specialty_id:string; doctor_id:string|null; service_doctors:Array<{doctor_id:string}>|null };
  return {
    configured: true,
    doctors: (doctors.data ?? []).map(item), branches: (branches.data ?? []).map(item), rooms: [],
    branchAssignments: (branchAssignments.data ?? []).map((row: { doctor_id: string; branch_id: string }) => ({ doctorId: row.doctor_id, branchId: row.branch_id })),
    services: ((services.data ?? []) as ServiceRow[]).map((service) => ({ id: service.id, nameEn: service.name_en, durationMinutes: service.duration_minutes, specialtyId: service.specialty_id, doctorId: service.doctor_id, assignedDoctorIds: (service.service_doctors ?? []).map((assignment) => assignment.doctor_id) })),
    workingHours: parseWorkingHours(workingHours.data?.value),
  };
}

export async function crmSchedulingSnapshot(): Promise<CrmSchedulingSnapshot> {
  const reference = await catalog();
  const db = supabaseAdmin();
  const [rooms, schedules, exceptions, closures, timeOff] = await Promise.all([
    db.from("crm_rooms").select("*").order("branch_name").order("name_en"),
    db.from("crm_schedule_templates").select("*,crm_schedule_room_assignments(room_id,room_name)").order("doctor_name").order("day_of_week"),
    db.from("crm_schedule_exceptions").select("*").order("exception_date", { ascending: false }).limit(100),
    db.from("crm_closures").select("*").order("starts_at", { ascending: false }).limit(100),
    db.from("crm_time_off").select("*").order("starts_at", { ascending: false }).limit(100),
  ]);
  const missing = [rooms.error, schedules.error, exceptions.error, closures.error, timeOff.error].some(tableMissing);
  if (missing) return { catalogConfigured: reference.configured, migrationReady: false, doctors: reference.doctors, branches: reference.branches, rooms: reference.rooms, schedules: [], exceptions: [], closures: [], timeOff: [], branchAssignments: reference.branchAssignments, services: reference.services, workingHours: reference.workingHours };
  for (const response of [rooms, schedules, exceptions, closures, timeOff]) if (response.error) throw new CrmSchedulingError(response.error.message);
  return {
    catalogConfigured: reference.configured, migrationReady: true, doctors: reference.doctors, branches: reference.branches,
    rooms: ((rooms.data ?? []) as RoomDb[]).map((row) => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar ?? undefined, roomType: row.room_type, active: row.is_active, branchId: row.branch_id })),
    schedules: ((schedules.data ?? []) as ScheduleDb[]).map((row) => ({
      id: row.id, doctorId: row.doctor_id, doctorName: row.doctor_name, branchId: row.branch_id, branchName: row.branch_name,
      roomId: row.crm_schedule_room_assignments?.[0]?.room_id ?? null, roomName: row.crm_schedule_room_assignments?.[0]?.room_name ?? null,
      dayOfWeek: row.day_of_week, startTime: hhmm(row.start_time), endTime: hhmm(row.end_time), slotDurationMinutes: row.slot_duration_minutes,
      firstComeFirstServe: row.first_come_first_serve === true, firstComeCapacity: row.first_come_capacity ?? 10,
      effectiveFrom: row.effective_from, effectiveTo: row.effective_to, active: row.is_active,
    })),
    exceptions: ((exceptions.data ?? []) as ExceptionDb[]).map((row) => ({ id: row.id, doctorName: row.doctor_name, branchName: row.branch_name, roomName: row.room_name, exceptionDate: row.exception_date, startTime: row.start_time ? hhmm(row.start_time) : null, endTime: row.end_time ? hhmm(row.end_time) : null, exceptionType: row.exception_type, reason: row.reason, active: row.is_active })),
    closures: ((closures.data ?? []) as ClosureDb[]).map((row) => ({ id: row.id, title: row.title, scope: row.scope, branchName: row.branch_name, roomName: row.room_name, startsAt: row.starts_at, endsAt: row.ends_at, notes: row.notes, active: row.is_active })),
    timeOff: ((timeOff.data ?? []) as TimeOffDb[]).map((row) => ({ id: row.id, doctorName: row.doctor_name, branchName: row.branch_name, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason, notes: row.notes, status: row.status })),
    branchAssignments: reference.branchAssignments,
    services: reference.services,
    workingHours: reference.workingHours,
  };
}

async function actor() { const value = await writeActor(); assertCan(value.role, "scheduling.manage"); return value; }
function named(items: CatalogItem[], id: string, label: string, includeInactive = false) {
  const value = items.find((item) => item.id === id && (includeInactive || item.active));
  if (!value) throw new CrmSchedulingError(`Choose a valid ${label}.`);
  return value;
}
function scheduleDateRangesOverlap(aFrom?: string | null, aTo?: string | null, bFrom?: string | null, bTo?: string | null) {
  return (!aTo || !bFrom || aTo >= bFrom) && (!bTo || !aFrom || bTo >= aFrom);
}
async function audit(actorId: string, action: string, entityId: string | null, newValues: Record<string, unknown>) {
  const { error } = await supabaseAdmin().from("audit_logs").insert({ actor_user_id: actorId, action, entity_type: "crm_schedule", entity_id: entityId, old_values: {}, new_values: newValues, metadata: { scheduling_system: "crm", deliberately_separate_from_admin: true } });
  if (error) throw new CrmSchedulingError(`Scheduling was saved but its audit record failed: ${error.message}`);
}

export async function saveCrmSchedule(input: { id?: string; doctorId: string; branchId: string; roomId: string; dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number; firstComeFirstServe: boolean; firstComeCapacity: number; effectiveFrom?: string; effectiveTo?: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  if (!snapshot.migrationReady) throw new CrmSchedulingError("Apply CRM migration 0038 before saving schedules.");
  const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = named(snapshot.branches, input.branchId, "branch"); const room = named(snapshot.rooms.filter((item) => item.branchId === branch.id), input.roomId, "active room");
  if (!snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === branch.id)) {
    throw new CrmSchedulingError(`${doctor.nameEn} is not assigned to ${branch.nameEn}. Add the branch assignment first.`);
  }
  const start = cleanTime(input.startTime); const end = cleanTime(input.endTime); if (end <= start) throw new CrmSchedulingError("End time must be after start time.");
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) throw new CrmSchedulingError("Choose a day.");
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new CrmSchedulingError("Effective end date must be on or after the start date.");
  if (input.active) {
    const overlaps = snapshot.schedules.filter((schedule) => (
      schedule.id !== input.id && schedule.active && schedule.dayOfWeek === input.dayOfWeek &&
      schedule.startTime < end && schedule.endTime > start &&
      scheduleDateRangesOverlap(schedule.effectiveFrom, schedule.effectiveTo, input.effectiveFrom, input.effectiveTo)
    ));
    const roomConflict = overlaps.find((schedule) => schedule.roomId === room.id);
    if (roomConflict) throw new CrmSchedulingError(`${room.nameEn} is already assigned to ${roomConflict.doctorName} on this day from ${roomConflict.startTime} to ${roomConflict.endTime}. Choose another room or time.`);
    const doctorConflict = overlaps.find((schedule) => schedule.doctorId === doctor.id);
    if (doctorConflict) throw new CrmSchedulingError(`${doctor.nameEn} already has a CRM session on this day from ${doctorConflict.startTime} to ${doctorConflict.endTime} at ${doctorConflict.branchName}.`);
  }
  const row = { doctor_id: doctor.id, doctor_name: doctor.nameEn, branch_id: branch.id, branch_name: branch.nameEn, day_of_week: input.dayOfWeek, start_time: start, end_time: end, slot_duration_minutes: Math.max(5, Math.min(240, Math.floor(input.slotDurationMinutes || 20))), first_come_first_serve: input.firstComeFirstServe, first_come_capacity: Math.max(1, Math.min(500, Math.floor(input.firstComeCapacity || 10))), effective_from: input.effectiveFrom || null, effective_to: input.effectiveTo || null, is_active: input.active, created_by: currentActor.id };
  const db = supabaseAdmin();
  let id = input.id;
  const previous = id ? snapshot.schedules.find((schedule) => schedule.id === id) : undefined;
  if (id && !previous) throw new CrmSchedulingError("CRM schedule not found.");
  if (id) { const { error } = await db.from("crm_schedule_templates").update({ ...row, created_by: undefined }).eq("id", id); if (error) throw new CrmSchedulingError(error.message); }
  else { const result = await db.from("crm_schedule_templates").insert(row).select("id").single<{ id: string }>(); if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not create CRM schedule."); id = result.data.id; }
  const { error: roomError } = await db.from("crm_schedule_room_assignments").upsert({ schedule_template_id: id, room_id: room.id, room_name: room.nameEn }, { onConflict: "schedule_template_id" });
  if (roomError) {
    if (!input.id) await db.from("crm_schedule_templates").delete().eq("id", id);
    else if (previous) {
      await db.from("crm_schedule_templates").update({
        doctor_id: previous.doctorId, doctor_name: previous.doctorName, branch_id: previous.branchId, branch_name: previous.branchName,
        day_of_week: previous.dayOfWeek, start_time: previous.startTime, end_time: previous.endTime,
        slot_duration_minutes: previous.slotDurationMinutes, first_come_first_serve: previous.firstComeFirstServe,
        first_come_capacity: previous.firstComeCapacity, effective_from: previous.effectiveFrom, effective_to: previous.effectiveTo, is_active: previous.active,
      }).eq("id", previous.id);
      if (previous.roomId && previous.roomName) await db.from("crm_schedule_room_assignments").upsert({ schedule_template_id: previous.id, room_id: previous.roomId, room_name: previous.roomName }, { onConflict: "schedule_template_id" });
    }
    throw new CrmSchedulingError(roomError.message.includes("overlapping") ? `${room.nameEn} became unavailable during this save. Choose another room or time.` : roomError.message);
  }
  await audit(currentActor.id, input.id ? "crm.schedule.updated" : "crm.schedule.created", id!, { ...row, room_id: room.id }); revalidatePath("/settings");
}

export async function saveCrmRoom(input: { id?: string; branchId: string; nameEn: string; nameAr?: string; roomType: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot(); const branch = named(snapshot.branches, input.branchId, "branch");
  if (!input.nameEn.trim()) throw new CrmSchedulingError("Room name is required.");
  const row = { branch_id: branch.id, branch_name: branch.nameEn, name_en: input.nameEn.trim(), name_ar: input.nameAr?.trim() || null, room_type: input.roomType.trim() || "clinic", is_active: input.active, created_by: currentActor.id };
  const db = supabaseAdmin(); let id = input.id;
  if (id) { const { error } = await db.from("crm_rooms").update({ ...row, created_by: undefined }).eq("id", id); if (error) throw new CrmSchedulingError(error.message); }
  else { const result = await db.from("crm_rooms").insert(row).select("id").single<{ id: string }>(); if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not create room."); id = result.data.id; }
  await audit(currentActor.id, input.id ? "crm.room.updated" : "crm.room.created", id!, row); revalidatePath("/settings");
}

export async function deleteCrmRoom(id: string) {
  const currentActor = await actor();
  if (!id) throw new CrmSchedulingError("Room id is required.");
  const db = supabaseAdmin();
  const [room, assignments, closures, exceptions] = await Promise.all([
    db.from("crm_rooms").select("id,name_en,branch_id").eq("id", id).maybeSingle<{ id:string; name_en:string; branch_id:string }>(),
    db.from("crm_schedule_room_assignments").select("id", { count: "exact", head: true }).eq("room_id", id),
    db.from("crm_closures").select("id", { count: "exact", head: true }).eq("room_id", id),
    db.from("crm_schedule_exceptions").select("id", { count: "exact", head: true }).eq("room_id", id),
  ]);
  if (room.error) throw new CrmSchedulingError(room.error.message);
  if (!room.data) throw new CrmSchedulingError("Room not found.");
  for (const response of [assignments, closures, exceptions]) if (response.error) throw new CrmSchedulingError(response.error.message);
  const references = (assignments.count ?? 0) + (closures.count ?? 0) + (exceptions.count ?? 0);
  if (references > 0) throw new CrmSchedulingError("This room is used by CRM scheduling history. Mark it inactive instead of deleting it.");
  const { error } = await db.from("crm_rooms").delete().eq("id", id);
  if (error) throw new CrmSchedulingError(error.message);
  await audit(currentActor.id, "crm.room.deleted", id, { name_en: room.data.name_en, branch_id: room.data.branch_id });
  revalidatePath("/settings");
}

export async function syncCrmRoomsFromAdmin() {
  const currentActor = await actor();
  if (!bookingConfigured()) throw new CrmSchedulingError("Booking/Admin room catalog is not configured.");
  const booking = bookingDb();
  const [adminRooms, adminBranches] = await Promise.all([
    booking.from("rooms").select("id,branch_id,name_en,name_ar,room_type,is_active").order("branch_id").order("name_en"),
    booking.from("branches").select("id,name_en"),
  ]);
  if (adminRooms.error) throw new CrmSchedulingError(`Could not read Admin rooms: ${adminRooms.error.message}`);
  if (adminBranches.error) throw new CrmSchedulingError(`Could not read Admin branches: ${adminBranches.error.message}`);
  const branchNames = new Map((adminBranches.data ?? []).map((branch: { id:string; name_en:string }) => [branch.id, branch.name_en]));
  const sourceRooms = (adminRooms.data ?? []) as Array<{ id:string; branch_id:string; name_en:string; name_ar:string|null; room_type:string; is_active:boolean }>;
  const db = supabaseAdmin();
  const adminIds = new Set(sourceRooms.map((room) => room.id));
  const existing = await db.from("crm_rooms").select("id,branch_id,branch_name,name_en,name_ar,room_type,is_active");
  if (existing.error) throw new CrmSchedulingError(existing.error.message);
  type ExistingRoom = { id:string; branch_id:string; branch_name:string; name_en:string; name_ar:string|null; room_type:string; is_active:boolean };
  const existingRooms = (existing.data ?? []) as ExistingRoom[];
  const existingById = new Map(existingRooms.map((room) => [room.id, room]));
  const detail = (room: { id:string; branch_id:string; name_en:string; branch_name?:string }) => ({
    id: room.id,
    name: room.name_en,
    branchName: room.branch_name ?? branchNames.get(room.branch_id) ?? "Unknown branch",
  });
  const added = sourceRooms.filter((room) => !existingById.has(room.id)).map(detail);
  const updated = sourceRooms.filter((room) => {
    const current = existingById.get(room.id);
    return current && (
      current.branch_id !== room.branch_id || current.name_en !== room.name_en ||
      (current.name_ar ?? null) !== (room.name_ar ?? null) || current.room_type !== (room.room_type || "clinic") ||
      current.is_active !== room.is_active
    );
  }).map(detail);
  const temporary = existingRooms.filter((room) => !adminIds.has(room.id));
  const remapAfterCopy: Array<{ room: ExistingRoom; match: typeof sourceRooms[number] }> = [];
  const deleted: RoomSyncItem[] = [];
  const retained: RoomSyncItem[] = [];
  for (const room of temporary) {
    const match = sourceRooms.find((candidate) => candidate.branch_id === room.branch_id && candidate.name_en.trim().toLowerCase() === room.name_en.trim().toLowerCase());
    const [assignments, closures, exceptions] = await Promise.all([
      db.from("crm_schedule_room_assignments").select("id", { count: "exact", head: true }).eq("room_id", room.id),
      db.from("crm_closures").select("id", { count: "exact", head: true }).eq("room_id", room.id),
      db.from("crm_schedule_exceptions").select("id", { count: "exact", head: true }).eq("room_id", room.id),
    ]);
    for (const response of [assignments, closures, exceptions]) if (response.error) throw new CrmSchedulingError(response.error.message);
    const references = (assignments.count ?? 0) + (closures.count ?? 0) + (exceptions.count ?? 0);
    if (references > 0 && match) {
      const legacyName = `${room.name_en} (legacy ${room.id.slice(0, 6)})`;
      const renamed = await db.from("crm_rooms").update({ name_en: legacyName, is_active: false }).eq("id", room.id);
      if (renamed.error) throw new CrmSchedulingError(`Could not prepare temporary room ${room.name_en}: ${renamed.error.message}`);
      remapAfterCopy.push({ room, match });
      continue;
    } else if (references > 0) {
      const deactivation = await db.from("crm_rooms").update({ is_active: false }).eq("id", room.id);
      if (deactivation.error) throw new CrmSchedulingError(`Could not retain historical room ${room.name_en}: ${deactivation.error.message}`);
      retained.push(detail(room));
      continue;
    }
    const deletion = await db.from("crm_rooms").delete().eq("id", room.id);
    if (deletion.error) throw new CrmSchedulingError(`Could not remove temporary room ${room.name_en}: ${deletion.error.message}`);
    deleted.push(detail(room));
  }

  if (sourceRooms.length > 0) {
    const payload = sourceRooms.map((room) => ({ id: room.id, branch_id: room.branch_id, branch_name: branchNames.get(room.branch_id) ?? "Unknown branch", name_en: room.name_en, name_ar: room.name_ar, room_type: room.room_type || "clinic", is_active: room.is_active, created_by: currentActor.id }));
    const { error } = await db.from("crm_rooms").upsert(payload, { onConflict: "id" });
    if (error) throw new CrmSchedulingError(`Could not copy Admin rooms: ${error.message}`);
  }

  for (const { room, match } of remapAfterCopy) {
    const remaps = await Promise.all([
      db.from("crm_schedule_room_assignments").update({ room_id: match.id, room_name: match.name_en }).eq("room_id", room.id),
      db.from("crm_closures").update({ room_id: match.id, room_name: match.name_en }).eq("room_id", room.id),
      db.from("crm_schedule_exceptions").update({ room_id: match.id, room_name: match.name_en }).eq("room_id", room.id),
    ]);
    const remapError = remaps.find((response) => response.error)?.error;
    if (remapError) throw new CrmSchedulingError(`Could not replace temporary room ${room.name_en}: ${remapError.message}`);
    const deletion = await db.from("crm_rooms").delete().eq("id", room.id);
    if (deletion.error) throw new CrmSchedulingError(`Could not remove temporary room ${room.name_en}: ${deletion.error.message}`);
    deleted.push(detail(room));
  }
  const result: RoomSyncResult = { added, updated, deleted, retained, totalAdminRooms: sourceRooms.length };
  await audit(currentActor.id, "crm.rooms.synced_from_admin", null, { ...result });
  revalidatePath("/settings");
  return result;
}

export async function saveDoctorBranchAssignments(input: { doctorId: string; branchIds: string[] }) {
  const currentActor = await actor();
  if (!bookingConfigured()) throw new CrmSchedulingError("Booking/Admin branch catalog is not configured.");
  const snapshot = await crmSchedulingSnapshot();
  const doctor = named(snapshot.doctors, input.doctorId, "doctor", true);
  const uniqueBranchIds = [...new Set(input.branchIds.filter(Boolean))];
  if (uniqueBranchIds.length === 0) throw new CrmSchedulingError("Choose at least one branch for this doctor.");
  const activeBranchIds = new Set(snapshot.branches.filter((branch) => branch.active).map((branch) => branch.id));
  if (uniqueBranchIds.some((branchId) => !activeBranchIds.has(branchId))) throw new CrmSchedulingError("Choose only active clinic branches.");

  const booking = bookingDb();
  const upsert = await booking.from("doctor_branch_assignments").upsert(
    uniqueBranchIds.map((branch_id) => ({ doctor_id: doctor.id, branch_id, is_active: true })),
    { onConflict: "doctor_id,branch_id" },
  );
  if (upsert.error) throw new CrmSchedulingError(`Could not add doctor branches: ${upsert.error.message}`);

  const existing = await booking.from("doctor_branch_assignments").select("branch_id").eq("doctor_id", doctor.id);
  if (existing.error) throw new CrmSchedulingError(`Could not verify doctor branches: ${existing.error.message}`);
  const removedIds = (existing.data ?? [])
    .map((row: { branch_id: string }) => row.branch_id)
    .filter((branchId: string) => !uniqueBranchIds.includes(branchId));
  if (removedIds.length > 0) {
    const deactivate = await booking.from("doctor_branch_assignments").update({ is_active: false }).eq("doctor_id", doctor.id).in("branch_id", removedIds);
    if (deactivate.error) throw new CrmSchedulingError(`Could not remove doctor branches: ${deactivate.error.message}`);
  }

  const branchNames = snapshot.branches.filter((branch) => uniqueBranchIds.includes(branch.id)).map((branch) => branch.nameEn);
  await audit(currentActor.id, "crm.doctor_branches.updated", doctor.id, { doctor_name: doctor.nameEn, branch_ids: uniqueBranchIds, branch_names: branchNames });
  revalidatePath("/settings");
  return { doctorName: doctor.nameEn, branchNames };
}

export async function saveCrmClosure(input: { title: string; scope: string; branchId?: string; roomId?: string; startsAt: string; endsAt: string; notes?: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  const branch = input.branchId ? named(snapshot.branches, input.branchId, "branch") : null;
  const room = input.roomId ? named(snapshot.rooms, input.roomId, "room", true) : null;
  if (!input.title.trim()) throw new CrmSchedulingError("Closure title is required."); if (!input.startsAt || !input.endsAt || input.endsAt <= input.startsAt) throw new CrmSchedulingError("Closure end must be after its start.");
  if (!['organization','branch','room'].includes(input.scope)) throw new CrmSchedulingError("Choose a closure scope.");
  const row = { title: input.title.trim(), scope: input.scope, branch_id: branch?.id ?? null, branch_name: branch?.nameEn ?? null, room_id: room?.id ?? null, room_name: room?.nameEn ?? null, starts_at: input.startsAt, ends_at: input.endsAt, notes: input.notes?.trim() || null, is_active: input.active, created_by: currentActor.id };
  const result = await supabaseAdmin().from("crm_closures").insert(row).select("id").single<{ id: string }>(); if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not add closure."); await audit(currentActor.id, "crm.closure.created", result.data.id, row); revalidatePath("/settings");
}

export async function saveCrmScheduleException(input: { doctorId: string; branchId: string; roomId?: string; exceptionDate: string; startTime?: string; endTime?: string; exceptionType: string; reason?: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = named(snapshot.branches, input.branchId, "branch");
  if (!snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === branch.id)) throw new CrmSchedulingError(`${doctor.nameEn} is not assigned to ${branch.nameEn}.`);
  const room = input.roomId ? named(snapshot.rooms.filter((item) => item.branchId === branch.id), input.roomId, "room", true) : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.exceptionDate)) throw new CrmSchedulingError("Choose an exception date.");
  if (!["available","unavailable","modified"].includes(input.exceptionType)) throw new CrmSchedulingError("Choose a valid exception type.");
  const start = input.startTime ? cleanTime(input.startTime) : null; const end = input.endTime ? cleanTime(input.endTime) : null;
  if ((start && !end) || (!start && end) || (start && end && end <= start)) throw new CrmSchedulingError("Provide a valid start and end time, or leave both blank for the full day.");
  const row = { doctor_id: doctor.id, doctor_name: doctor.nameEn, branch_id: branch.id, branch_name: branch.nameEn, room_id: room?.id ?? null, room_name: room?.nameEn ?? null, exception_date: input.exceptionDate, start_time: start, end_time: end, exception_type: input.exceptionType, reason: input.reason?.trim() || null, is_active: input.active, created_by: currentActor.id };
  const result = await supabaseAdmin().from("crm_schedule_exceptions").insert(row).select("id").single<{ id: string }>();
  if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not add schedule exception.");
  await audit(currentActor.id, "crm.schedule_exception.created", result.data.id, row); revalidatePath("/settings");
}

export async function saveCrmTimeOff(input: { doctorId: string; branchId?: string; startsAt: string; endsAt: string; reason: string; notes?: string; status: string }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot(); const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = input.branchId ? named(snapshot.branches, input.branchId, "branch") : null;
  if (branch && !snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === branch.id)) throw new CrmSchedulingError(`${doctor.nameEn} is not assigned to ${branch.nameEn}.`);
  if (!input.reason.trim()) throw new CrmSchedulingError("Reason is required."); if (!input.startsAt || !input.endsAt || input.endsAt <= input.startsAt) throw new CrmSchedulingError("Time off end must be after its start."); if (!['pending','approved','rejected','cancelled'].includes(input.status)) throw new CrmSchedulingError("Choose a valid status.");
  const row = { doctor_id: doctor.id, doctor_name: doctor.nameEn, branch_id: branch?.id ?? null, branch_name: branch?.nameEn ?? null, starts_at: input.startsAt, ends_at: input.endsAt, reason: input.reason.trim(), notes: input.notes?.trim() || null, status: input.status, created_by: currentActor.id };
  const result = await supabaseAdmin().from("crm_time_off").insert(row).select("id").single<{ id: string }>(); if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not add time off."); await audit(currentActor.id, "crm.time_off.created", result.data.id, row); revalidatePath("/settings");
}
