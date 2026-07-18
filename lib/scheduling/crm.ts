import "server-only";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth/permissions";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import { writeActor } from "@/lib/data/actor";
import { parseWorkingHours, type CapacityService, type WorkingHours } from "@/lib/scheduling/capacity";
import { supabaseAdmin } from "@/lib/supabase/server";

export class CrmSchedulingError extends Error {}

export interface CatalogItem { id: string; nameEn: string; nameAr?: string; active: boolean; publicBooking?: boolean; branchId?: string; roomType?: string; specialtyId?: string; photoUrl?: string }
export interface CrmScheduleRow {
  id: string; doctorId: string; doctorName: string; branchId: string; branchName: string; roomId: string | null;
  roomName: string | null; dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number;
  firstComeFirstServe: boolean; firstComeCapacity: number; effectiveFrom: string | null; effectiveTo: string | null;
  active: boolean; showOnBookingWebsite: boolean;
}
export interface CrmSpecialScheduleRow {
  id: string; seriesId: string; doctorId: string; doctorName: string; branchId: string; branchName: string;
  roomId: string; roomName: string; scheduleDate: string; startTime: string; endTime: string;
  firstComeFirstServe: boolean; firstComeCapacity: number; active: boolean; showOnBookingWebsite: boolean;
  seriesStartDate: string; consecutiveDays: number; repeatEveryMonths: number; repeatCount: number;
  cycleNumber: number; dayNumber: number;
}
export interface CrmClosureRow { id: string; title: string; scope: string; branchName: string | null; roomName: string | null; startsAt: string; endsAt: string; notes: string | null; active: boolean }
export interface CrmTimeOffRow { id: string; doctorName: string; branchName: string | null; startsAt: string; endsAt: string; reason: string; notes: string | null; status: string }
export interface CrmScheduleExceptionRow { id: string; doctorName: string; branchName: string; roomName: string | null; exceptionDate: string; startTime: string | null; endTime: string | null; exceptionType: string; reason: string | null; active: boolean }
export interface DoctorBranchAssignment { doctorId: string; branchId: string }
export interface RoomSyncItem { id: string; name: string; branchName: string }
export interface RoomSyncResult { added: RoomSyncItem[]; updated: RoomSyncItem[]; deleted: RoomSyncItem[]; retained: RoomSyncItem[]; totalAdminRooms: number }
export interface DuplicateScheduleResult { created: number; skipped: string[] }
export interface CrmSchedulingSnapshot {
  catalogConfigured: boolean; migrationReady: boolean; doctors: CatalogItem[]; branches: CatalogItem[]; rooms: CatalogItem[];
  schedules: CrmScheduleRow[]; specialSchedules: CrmSpecialScheduleRow[]; exceptions: CrmScheduleExceptionRow[]; closures: CrmClosureRow[]; timeOff: CrmTimeOffRow[];
  branchAssignments: DoctorBranchAssignment[]; services: CapacityService[]; workingHours: WorkingHours;
}

type ScheduleDb = {
  id:string; doctor_id:string; branch_id:string; day_of_week:number; start_time:string; end_time:string;
  first_come_first_serve:boolean; first_come_capacity:number; is_active:boolean; show_on_booking_website:boolean;
  schedule_room_assignments?:Array<{room_id:string;rooms:{id:string;name_en:string}|Array<{id:string;name_en:string}>|null}>;
};
type ScheduleRoomDb = NonNullable<ScheduleDb["schedule_room_assignments"]>[number];
type BlockDb = {
  id:string; block_date:string; end_date:string; start_time:string|null; end_time:string|null; doctor_id:string|null;
  room_id:string|null; branch_id:string|null; reason:string|null; is_full_day:boolean; block_type:string; title:string|null;
  notes:string|null; status:string; is_active:boolean;
};
type SpecialScheduleDb = {
  id:string;series_id:string;doctor_id:string;branch_id:string;room_id:string;schedule_date:string;start_time:string;end_time:string;
  first_come_first_serve:boolean;first_come_capacity:number;is_active:boolean;show_on_booking_website:boolean;
  series_start_date:string;consecutive_days:number;repeat_every_months:number;repeat_count:number;cycle_number:number;day_number:number;
};

const hhmm = (value: string) => value.slice(0, 5);
const cleanTime = (value: string) => {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new CrmSchedulingError("Enter a valid time.");
  return value;
};
const migrationMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST204" || error?.code === "PGRST205" || Boolean(error?.message?.includes("show_on_booking_website"));
const relatedRoom = (value: ScheduleRoomDb) => {
  const room = value.rooms;
  return Array.isArray(room) ? room[0] : room;
};
const dateTime = (date: string, time: string | null, end = false) => `${date}T${time ? hhmm(time) : end ? "23:59" : "00:00"}`;
const splitDateTime = (value: string) => {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  if (!match) throw new CrmSchedulingError("Choose a valid date and time.");
  return { date: match[1], time: match[2] };
};

async function actor() { const value = await writeActor(); assertCan(value.role, "scheduling.manage"); return value; }
function named(items: CatalogItem[], id: string, label: string, includeInactive = false) {
  const value = items.find((item) => item.id === id && (includeInactive || item.active));
  if (!value) throw new CrmSchedulingError(`Choose a valid ${label}.`);
  return value;
}
async function audit(actorId: string, action: string, entityId: string | null, newValues: Record<string, unknown>) {
  const { error } = await supabaseAdmin().from("audit_logs").insert({
    actor_user_id: actorId, action, entity_type: "booking_schedule", entity_id: entityId,
    old_values: {}, new_values: newValues,
    metadata: { scheduling_system: "shared", primary_workspace: "crm", applies_to: ["crm", "online_booking"] },
  });
  if (error) throw new CrmSchedulingError(`Scheduling was saved but its audit record failed: ${error.message}`);
}
function refreshScheduling() { revalidatePath("/settings"); revalidatePath("/calendar"); revalidatePath("/reservations"); }

export async function crmSchedulingSnapshot(): Promise<CrmSchedulingSnapshot> {
  const empty: CrmSchedulingSnapshot = {
    catalogConfigured: false, migrationReady: false, doctors: [], branches: [], rooms: [], schedules: [], specialSchedules: [], exceptions: [], closures: [], timeOff: [],
    branchAssignments: [], services: [], workingHours: parseWorkingHours(null),
  };
  if (!bookingConfigured()) return empty;
  const db = bookingDb();
  const [doctors, branches, rooms, assignments, services, hours, schedules, specialSchedules, blocks] = await Promise.all([
    db.from("doctors").select("id,name_en,name_ar,is_active,specialty_id,photo_url").order("display_order"),
    db.from("branches").select("id,name_en,name_ar,is_active,is_public_branch").order("display_order"),
    db.from("rooms").select("id,branch_id,name_en,name_ar,room_type,is_active").order("branch_id").order("name_en"),
    db.from("doctor_branch_assignments").select("doctor_id,branch_id,is_active").eq("is_active", true),
    db.from("services").select("id,name_en,duration_minutes,specialty_id,doctor_id,service_doctors(doctor_id)").eq("is_active", true),
    db.from("clinic_settings").select("value").eq("key", "working_hours_en").maybeSingle<{ value: string }>(),
    db.from("doctor_schedule_templates").select("id,doctor_id,branch_id,day_of_week,start_time,end_time,first_come_first_serve,first_come_capacity,is_active,show_on_booking_website,schedule_room_assignments(room_id,rooms(id,name_en))").order("doctor_id").order("day_of_week"),
    db.from("doctor_special_schedules").select("id,series_id,doctor_id,branch_id,room_id,schedule_date,start_time,end_time,first_come_first_serve,first_come_capacity,is_active,show_on_booking_website,series_start_date,consecutive_days,repeat_every_months,repeat_count,cycle_number,day_number").order("schedule_date").limit(1000),
    db.from("blocked_times").select("id,block_date,end_date,start_time,end_time,doctor_id,room_id,branch_id,reason,is_full_day,block_type,title,notes,status,is_active").order("block_date", { ascending: false }).limit(250),
  ]);
  const responses = [doctors, branches, rooms, assignments, services, hours];
  for (const response of responses) if (response.error) throw new CrmSchedulingError(`Could not read shared scheduling data: ${response.error.message}`);
  if (migrationMissing(schedules.error) || migrationMissing(specialSchedules.error) || migrationMissing(blocks.error)) {
    return { ...empty, catalogConfigured: true, migrationReady: false };
  }
  for (const response of [schedules, specialSchedules, blocks]) if (response.error) throw new CrmSchedulingError(`Could not read shared scheduling data: ${response.error.message}`);

  type DoctorDb = { id:string;name_en:string;name_ar:string|null;is_active:boolean;specialty_id:string;photo_url:string|null };
  type BranchDb = { id:string;name_en:string;name_ar:string|null;is_active:boolean;is_public_branch:boolean };
  type RoomDb = { id:string;branch_id:string;name_en:string;name_ar:string|null;room_type:string;is_active:boolean };
  type ServiceDb = { id:string;name_en:string;duration_minutes:number;specialty_id:string;doctor_id:string|null;service_doctors:Array<{doctor_id:string}>|null };
  const doctorRows = (doctors.data ?? []) as DoctorDb[];
  const branchRows = (branches.data ?? []) as BranchDb[];
  const roomRows = (rooms.data ?? []) as RoomDb[];
  const doctorById = new Map(doctorRows.map((row) => [row.id, row]));
  const branchById = new Map(branchRows.map((row) => [row.id, row]));
  const roomById = new Map(roomRows.map((row) => [row.id, row]));
  const scheduleRows = (schedules.data ?? []) as ScheduleDb[];
  const specialScheduleRows = (specialSchedules.data ?? []) as SpecialScheduleDb[];
  const blockRows = (blocks.data ?? []) as BlockDb[];

  return {
    catalogConfigured: true,
    migrationReady: true,
    doctors: doctorRows.map((row) => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar ?? undefined, active: row.is_active, specialtyId: row.specialty_id, photoUrl: row.photo_url ?? undefined })),
    branches: branchRows.map((row) => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar ?? undefined, active: row.is_active, publicBooking: row.is_public_branch })),
    rooms: roomRows.map((row) => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar ?? undefined, roomType: row.room_type, active: row.is_active, branchId: row.branch_id })),
    schedules: scheduleRows.map((row) => {
      const assignment = row.schedule_room_assignments?.[0];
      const room = assignment ? relatedRoom(assignment) : null;
      return {
        id: row.id, doctorId: row.doctor_id, doctorName: doctorById.get(row.doctor_id)?.name_en ?? "Unknown doctor",
        branchId: row.branch_id, branchName: branchById.get(row.branch_id)?.name_en ?? "Unknown branch",
        roomId: assignment?.room_id ?? null, roomName: room?.name_en ?? null, dayOfWeek: row.day_of_week,
        startTime: hhmm(row.start_time), endTime: hhmm(row.end_time), slotDurationMinutes: 20,
        firstComeFirstServe: row.first_come_first_serve === true, firstComeCapacity: row.first_come_capacity ?? 10,
        effectiveFrom: null, effectiveTo: null, active: row.is_active, showOnBookingWebsite: row.show_on_booking_website !== false,
      };
    }),
    specialSchedules: specialScheduleRows.map((row) => ({
      id: row.id, seriesId: row.series_id, doctorId: row.doctor_id, doctorName: doctorById.get(row.doctor_id)?.name_en ?? "Unknown doctor",
      branchId: row.branch_id, branchName: branchById.get(row.branch_id)?.name_en ?? "Unknown branch",
      roomId: row.room_id, roomName: roomById.get(row.room_id)?.name_en ?? "Unknown room", scheduleDate: row.schedule_date,
      startTime: hhmm(row.start_time), endTime: hhmm(row.end_time), firstComeFirstServe: row.first_come_first_serve === true,
      firstComeCapacity: row.first_come_capacity ?? 10, active: row.is_active, showOnBookingWebsite: row.show_on_booking_website !== false,
      seriesStartDate: row.series_start_date, consecutiveDays: row.consecutive_days, repeatEveryMonths: row.repeat_every_months,
      repeatCount: row.repeat_count, cycleNumber: row.cycle_number, dayNumber: row.day_number,
    })),
    exceptions: blockRows.filter((row) => row.block_type === "exception").map((row) => ({
      id: row.id, doctorName: row.doctor_id ? doctorById.get(row.doctor_id)?.name_en ?? "Unknown doctor" : "All doctors",
      branchName: row.branch_id ? branchById.get(row.branch_id)?.name_en ?? "Unknown branch" : "All branches",
      roomName: row.room_id ? roomById.get(row.room_id)?.name_en ?? null : null, exceptionDate: row.block_date,
      startTime: row.start_time ? hhmm(row.start_time) : null, endTime: row.end_time ? hhmm(row.end_time) : null,
      exceptionType: row.title ?? "unavailable", reason: row.reason, active: row.is_active && row.status === "approved",
    })),
    closures: blockRows.filter((row) => row.block_type === "closure").map((row) => ({
      id: row.id, title: row.title || row.reason || "Closure", scope: row.room_id ? "room" : row.branch_id ? "branch" : "organization",
      branchName: row.branch_id ? branchById.get(row.branch_id)?.name_en ?? null : null,
      roomName: row.room_id ? roomById.get(row.room_id)?.name_en ?? null : null,
      startsAt: dateTime(row.block_date, row.start_time), endsAt: dateTime(row.end_date, row.end_time, true), notes: row.notes,
      active: row.is_active && row.status === "approved",
    })),
    timeOff: blockRows.filter((row) => row.block_type === "time_off").map((row) => ({
      id: row.id, doctorName: row.doctor_id ? doctorById.get(row.doctor_id)?.name_en ?? "Unknown doctor" : "All doctors",
      branchName: row.branch_id ? branchById.get(row.branch_id)?.name_en ?? null : null,
      startsAt: dateTime(row.block_date, row.start_time), endsAt: dateTime(row.end_date, row.end_time, true),
      reason: row.reason ?? "Time off", notes: row.notes, status: row.status,
    })),
    branchAssignments: ((assignments.data ?? []) as Array<{doctor_id:string;branch_id:string}>).map((row) => ({ doctorId: row.doctor_id, branchId: row.branch_id })),
    services: ((services.data ?? []) as ServiceDb[]).map((row) => ({ id: row.id, nameEn: row.name_en, durationMinutes: row.duration_minutes, specialtyId: row.specialty_id, doctorId: row.doctor_id, assignedDoctorIds: (row.service_doctors ?? []).map((item) => item.doctor_id) })),
    workingHours: parseWorkingHours(hours.data?.value),
  };
}

function overlaps(a: { dayOfWeek:number;startTime:string;endTime:string;active:boolean }, day: number, start: string, end: string) {
  return a.active && a.dayOfWeek === day && a.startTime < end && a.endTime > start;
}
function availableRoom(snapshot: CrmSchedulingSnapshot, branchId: string, day: number, start: string, end: string, preferredId?: string | null, ignoreScheduleId?: string) {
  const occupied = new Set(snapshot.schedules.filter((row) => row.id !== ignoreScheduleId && row.branchId === branchId && row.roomId && overlaps(row, day, start, end)).map((row) => row.roomId));
  const rooms = snapshot.rooms.filter((room) => room.branchId === branchId && room.active);
  return rooms.find((room) => room.id === preferredId && !occupied.has(room.id)) ?? rooms.find((room) => !occupied.has(room.id)) ?? null;
}

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new CrmSchedulingError("Choose a valid start date.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new CrmSchedulingError("Choose a valid start date.");
  return date;
}

function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }
function addDaysUtc(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function addMonthsClamped(value: Date, months: number) {
  const desiredDay = value.getUTCDate();
  const first = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(desiredDay, lastDay));
  return first;
}

export function buildSpecialScheduleOccurrences(input: { startDate: string; consecutiveDays: number; repeatEveryMonths: number; repeatCount: number }) {
  const start = parseDateOnly(input.startDate);
  const consecutiveDays = Math.floor(input.consecutiveDays);
  const repeatEveryMonths = Math.floor(input.repeatEveryMonths);
  const repeatCount = repeatEveryMonths === 0 ? 1 : Math.floor(input.repeatCount);
  if (consecutiveDays < 1 || consecutiveDays > 31) throw new CrmSchedulingError("Consecutive days must be between 1 and 31.");
  if (repeatEveryMonths < 0 || repeatEveryMonths > 24) throw new CrmSchedulingError("Repeat interval must be between 1 and 24 months, or one-time.");
  if (repeatCount < 1 || repeatCount > 36) throw new CrmSchedulingError("Number of visits must be between 1 and 36.");
  const occurrences = Array.from({ length: repeatCount }, (_, cycleIndex) => {
    const cycleStart = addMonthsClamped(start, cycleIndex * repeatEveryMonths);
    return Array.from({ length: consecutiveDays }, (_, dayIndex) => ({
      scheduleDate: dateOnly(addDaysUtc(cycleStart, dayIndex)),
      cycleNumber: cycleIndex + 1,
      dayNumber: dayIndex + 1,
    }));
  }).flat();
  if (new Set(occurrences.map((item) => item.scheduleDate)).size !== occurrences.length) {
    throw new CrmSchedulingError("This repeat pattern overlaps itself. Reduce consecutive days or use a wider month interval.");
  }
  return occurrences;
}

export async function saveCrmSpecialSchedule(input: {
  doctorId: string; branchId: string; roomId: string; startDate: string; consecutiveDays: number; repeatEveryMonths: number;
  repeatCount: number; startTime: string; endTime: string; firstComeFirstServe: boolean; firstComeCapacity: number;
  active: boolean; showOnBookingWebsite: boolean;
}) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  if (!snapshot.migrationReady) throw new CrmSchedulingError("Apply booking migration 022 before saving special visits.");
  const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = named(snapshot.branches, input.branchId, "branch");
  const room = named(snapshot.rooms.filter((item) => item.branchId === branch.id), input.roomId, "active room");
  if (!snapshot.branchAssignments.some((item) => item.doctorId === doctor.id && item.branchId === branch.id)) throw new CrmSchedulingError(`${doctor.nameEn} is not assigned to ${branch.nameEn}. Add the branch assignment first.`);
  const start = cleanTime(input.startTime); const end = cleanTime(input.endTime);
  if (end <= start) throw new CrmSchedulingError("End time must be after start time.");
  const occurrences = buildSpecialScheduleOccurrences(input);
  for (const occurrence of occurrences) {
    const day = parseDateOnly(occurrence.scheduleDate).getUTCDay();
    const weeklyConflicts = snapshot.schedules.filter((row) => overlaps(row, day, start, end));
    const doctorWeeklyConflict = weeklyConflicts.find((row) => row.doctorId === doctor.id);
    if (doctorWeeklyConflict) throw new CrmSchedulingError(`${doctor.nameEn} already has weekly hours on ${occurrence.scheduleDate} from ${doctorWeeklyConflict.startTime} to ${doctorWeeklyConflict.endTime}.`);
    const roomWeeklyConflict = weeklyConflicts.find((row) => row.branchId === branch.id && row.roomId === room.id);
    if (roomWeeklyConflict) throw new CrmSchedulingError(`${room.nameEn} is occupied on ${occurrence.scheduleDate} from ${roomWeeklyConflict.startTime} to ${roomWeeklyConflict.endTime}.`);
    const datedConflicts = snapshot.specialSchedules.filter((row) => row.active && row.scheduleDate === occurrence.scheduleDate && row.startTime < end && row.endTime > start);
    const doctorDatedConflict = datedConflicts.find((row) => row.doctorId === doctor.id);
    if (doctorDatedConflict) throw new CrmSchedulingError(`${doctor.nameEn} already has a special visit on ${occurrence.scheduleDate} from ${doctorDatedConflict.startTime} to ${doctorDatedConflict.endTime}.`);
    const roomDatedConflict = datedConflicts.find((row) => row.branchId === branch.id && row.roomId === room.id);
    if (roomDatedConflict) throw new CrmSchedulingError(`${room.nameEn} already has a special visit on ${occurrence.scheduleDate} from ${roomDatedConflict.startTime} to ${roomDatedConflict.endTime}.`);
  }
  const seriesId = randomUUID();
  const repeatEveryMonths = Math.max(0, Math.min(24, Math.floor(input.repeatEveryMonths)));
  const repeatCount = repeatEveryMonths === 0 ? 1 : Math.max(1, Math.min(36, Math.floor(input.repeatCount)));
  const rows = occurrences.map((occurrence) => ({
    series_id: seriesId, doctor_id: doctor.id, branch_id: branch.id, room_id: room.id, schedule_date: occurrence.scheduleDate,
    start_time: start, end_time: end, first_come_first_serve: input.firstComeFirstServe,
    first_come_capacity: Math.max(1, Math.min(500, Math.floor(input.firstComeCapacity || 10))),
    is_active: input.active, show_on_booking_website: input.showOnBookingWebsite, series_start_date: input.startDate,
    consecutive_days: Math.floor(input.consecutiveDays), repeat_every_months: repeatEveryMonths, repeat_count: repeatCount,
    cycle_number: occurrence.cycleNumber, day_number: occurrence.dayNumber,
  }));
  const result = await bookingDb().from("doctor_special_schedules").insert(rows);
  if (result.error) throw new CrmSchedulingError(result.error.message);
  await audit(currentActor.id, "shared.special_schedule.created", seriesId, { doctor_id: doctor.id, branch_id: branch.id, room_id: room.id, dates: occurrences.map((item) => item.scheduleDate), start_time: start, end_time: end });
  refreshScheduling();
}

export async function deleteCrmSpecialSchedule(seriesId: string) {
  const currentActor = await actor();
  if (!seriesId) throw new CrmSchedulingError("Special visit series id is required.");
  const db = bookingDb();
  const existing = await db.from("doctor_special_schedules").select("id,doctor_id,branch_id,schedule_date,start_time,end_time").eq("series_id", seriesId);
  if (existing.error) throw new CrmSchedulingError(existing.error.message);
  if (!existing.data?.length) throw new CrmSchedulingError("Special visit series not found.");
  const removed = await db.from("doctor_special_schedules").delete().eq("series_id", seriesId);
  if (removed.error) throw new CrmSchedulingError(removed.error.message);
  await audit(currentActor.id, "shared.special_schedule.deleted", seriesId, { occurrences: existing.data });
  refreshScheduling();
}

export async function saveCrmSchedule(input: { id?: string; doctorId: string; branchId: string; roomId: string; dayOfWeek: number; startTime: string; endTime: string; slotDurationMinutes: number; firstComeFirstServe: boolean; firstComeCapacity: number; effectiveFrom?: string; effectiveTo?: string; active: boolean; showOnBookingWebsite: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  if (!snapshot.migrationReady) throw new CrmSchedulingError("Apply booking migration 018 before saving shared schedules.");
  const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = named(snapshot.branches, input.branchId, "branch");
  const room = named(snapshot.rooms.filter((item) => item.branchId === branch.id), input.roomId, "active room");
  if (!snapshot.branchAssignments.some((item) => item.doctorId === doctor.id && item.branchId === branch.id)) throw new CrmSchedulingError(`${doctor.nameEn} is not assigned to ${branch.nameEn}. Add the branch assignment first.`);
  const start = cleanTime(input.startTime); const end = cleanTime(input.endTime);
  if (end <= start) throw new CrmSchedulingError("End time must be after start time.");
  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) throw new CrmSchedulingError("Choose a day.");
  if (input.active) {
    const conflicts = snapshot.schedules.filter((row) => row.id !== input.id && overlaps(row, input.dayOfWeek, start, end));
    const doctorConflict = conflicts.find((row) => row.doctorId === doctor.id);
    if (doctorConflict) throw new CrmSchedulingError(`${doctor.nameEn} already has a session from ${doctorConflict.startTime} to ${doctorConflict.endTime} at ${doctorConflict.branchName}.`);
    const roomConflict = conflicts.find((row) => row.roomId === room.id);
    if (roomConflict) throw new CrmSchedulingError(`${room.nameEn} is already assigned to ${roomConflict.doctorName} from ${roomConflict.startTime} to ${roomConflict.endTime}.`);
  }
  const db = bookingDb();
  const patch = {
    doctor_id: doctor.id, branch_id: branch.id, day_of_week: input.dayOfWeek, start_time: start, end_time: end,
    first_come_first_serve: input.firstComeFirstServe, first_come_capacity: Math.max(1, Math.min(500, Math.floor(input.firstComeCapacity || 10))),
    is_active: input.active, show_on_booking_website: input.showOnBookingWebsite,
  };
  let id = input.id;
  if (id) {
    const result = await db.from("doctor_schedule_templates").update(patch).eq("id", id);
    if (result.error) throw new CrmSchedulingError(result.error.message);
    const cleared = await db.from("schedule_room_assignments").delete().eq("schedule_template_id", id);
    if (cleared.error) throw new CrmSchedulingError(cleared.error.message);
  } else {
    const result = await db.from("doctor_schedule_templates").insert(patch).select("id").single<{id:string}>();
    if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not create schedule.");
    id = result.data.id;
  }
  const assigned = await db.from("schedule_room_assignments").insert({ schedule_template_id: id, room_id: room.id });
  if (assigned.error) throw new CrmSchedulingError(`Schedule saved, but room assignment failed: ${assigned.error.message}`);
  await audit(currentActor.id, input.id ? "shared.schedule.updated" : "shared.schedule.created", id!, { ...patch, room_id: room.id });
  refreshScheduling();
}

export async function deleteCrmSchedule(id: string) {
  const currentActor = await actor();
  if (!id) throw new CrmSchedulingError("Schedule id is required.");
  const db = bookingDb();
  const existing = await db.from("doctor_schedule_templates")
    .select("id,doctor_id,branch_id,day_of_week,start_time,end_time")
    .eq("id", id)
    .maybeSingle<{id:string;doctor_id:string;branch_id:string;day_of_week:number;start_time:string;end_time:string}>();
  if (existing.error || !existing.data) throw new CrmSchedulingError(existing.error?.message ?? "Schedule not found.");
  const removed = await db.from("doctor_schedule_templates").delete().eq("id", id);
  if (removed.error) throw new CrmSchedulingError(removed.error.message);
  await audit(currentActor.id, "shared.schedule.deleted", id, existing.data);
  refreshScheduling();
}

export async function duplicateCrmSchedule(input: { scheduleId: string; doctorIds: string[]; daysOfWeek: number[] }): Promise<DuplicateScheduleResult> {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  const source = snapshot.schedules.find((row) => row.id === input.scheduleId);
  if (!source) throw new CrmSchedulingError("Schedule not found.");
  const doctorIds = [...new Set(input.doctorIds.filter(Boolean))];
  const days = [...new Set(input.daysOfWeek)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (!doctorIds.length || !days.length) throw new CrmSchedulingError("Choose at least one doctor and one target day.");
  const db = bookingDb(); const createdIds: string[] = []; const skipped: string[] = [];
  const working = [...snapshot.schedules];
  for (const doctorId of doctorIds) for (const day of days) {
    const doctor = snapshot.doctors.find((row) => row.id === doctorId);
    if (!doctor) { skipped.push("Unknown doctor"); continue; }
    if (doctorId === source.doctorId && day === source.dayOfWeek) { skipped.push(`${doctor.nameEn} / original day`); continue; }
    if (!snapshot.branchAssignments.some((item) => item.doctorId === doctorId && item.branchId === source.branchId)) { skipped.push(`${doctor.nameEn} / not assigned to ${source.branchName}`); continue; }
    if (working.some((row) => row.doctorId === doctorId && overlaps(row, day, source.startTime, source.endTime))) { skipped.push(`${doctor.nameEn} / doctor conflict`); continue; }
    const room = availableRoom({ ...snapshot, schedules: working }, source.branchId, day, source.startTime, source.endTime, source.roomId);
    if (!room) { skipped.push(`${doctor.nameEn} / no available room`); continue; }
    const patch = { doctor_id: doctorId, branch_id: source.branchId, day_of_week: day, start_time: source.startTime, end_time: source.endTime, first_come_first_serve: source.firstComeFirstServe, first_come_capacity: source.firstComeCapacity, is_active: source.active, show_on_booking_website: source.showOnBookingWebsite };
    const inserted = await db.from("doctor_schedule_templates").insert(patch).select("id").single<{id:string}>();
    if (inserted.error || !inserted.data) { skipped.push(`${doctor.nameEn} / ${inserted.error?.message ?? "save failed"}`); continue; }
    const assignment = await db.from("schedule_room_assignments").insert({ schedule_template_id: inserted.data.id, room_id: room.id });
    if (assignment.error) { await db.from("doctor_schedule_templates").delete().eq("id", inserted.data.id); skipped.push(`${doctor.nameEn} / room conflict`); continue; }
    createdIds.push(inserted.data.id);
    working.push({ ...source, id: inserted.data.id, doctorId, doctorName: doctor.nameEn, dayOfWeek: day, roomId: room.id, roomName: room.nameEn });
  }
  await audit(currentActor.id, "shared.schedule.duplicated", source.id, { created_ids: createdIds, skipped });
  refreshScheduling();
  return { created: createdIds.length, skipped };
}

export async function saveCrmRoom(input: { id?: string; branchId: string; nameEn: string; nameAr?: string; roomType: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot(); const branch = named(snapshot.branches, input.branchId, "branch");
  if (!input.nameEn.trim()) throw new CrmSchedulingError("Room name is required.");
  const patch = { branch_id: branch.id, name_en: input.nameEn.trim(), name_ar: input.nameAr?.trim() || input.nameEn.trim(), room_type: input.roomType.trim() || "clinic", is_active: input.active };
  const db = bookingDb(); let id = input.id;
  if (id) { const result = await db.from("rooms").update(patch).eq("id", id); if (result.error) throw new CrmSchedulingError(result.error.message); }
  else { const result = await db.from("rooms").insert(patch).select("id").single<{id:string}>(); if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not create room."); id = result.data.id; }
  await audit(currentActor.id, input.id ? "shared.room.updated" : "shared.room.created", id!, patch); refreshScheduling();
}

export async function deleteCrmRoom(id: string) {
  const currentActor = await actor(); if (!id) throw new CrmSchedulingError("Room id is required.");
  const db = bookingDb();
  const [room, schedules, blocks, appointments] = await Promise.all([
    db.from("rooms").select("id,name_en,branch_id").eq("id", id).maybeSingle<{id:string;name_en:string;branch_id:string}>(),
    db.from("schedule_room_assignments").select("id", { count: "exact", head: true }).eq("room_id", id),
    db.from("blocked_times").select("id", { count: "exact", head: true }).eq("room_id", id),
    db.from("appointment_rooms").select("id", { count: "exact", head: true }).eq("room_id", id),
  ]);
  if (room.error || !room.data) throw new CrmSchedulingError(room.error?.message ?? "Room not found.");
  for (const response of [schedules, blocks, appointments]) if (response.error) throw new CrmSchedulingError(response.error.message);
  const references = (schedules.count ?? 0) + (blocks.count ?? 0) + (appointments.count ?? 0);
  if (references > 0) throw new CrmSchedulingError(`This room has ${references} scheduling or appointment record(s). Mark it inactive to preserve history.`);
  const removed = await db.from("rooms").delete().eq("id", id); if (removed.error) throw new CrmSchedulingError(removed.error.message);
  await audit(currentActor.id, "shared.room.deleted", id, { name_en: room.data.name_en, branch_id: room.data.branch_id }); refreshScheduling();
}

export async function syncCrmRoomsFromAdmin(): Promise<RoomSyncResult> {
  await actor(); const snapshot = await crmSchedulingSnapshot();
  return { added: [], updated: [], deleted: [], retained: snapshot.rooms.map((room) => ({ id: room.id, name: room.nameEn, branchName: snapshot.branches.find((branch) => branch.id === room.branchId)?.nameEn ?? "Unknown branch" })), totalAdminRooms: snapshot.rooms.length };
}

export async function saveDoctorBranchAssignments(input: { doctorId: string; branchIds: string[] }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot(); const doctor = named(snapshot.doctors, input.doctorId, "doctor", true);
  const branchIds = [...new Set(input.branchIds.filter(Boolean))]; if (!branchIds.length) throw new CrmSchedulingError("Choose at least one branch.");
  if (branchIds.some((id) => !snapshot.branches.some((branch) => branch.id === id && branch.active))) throw new CrmSchedulingError("Choose only active branches.");
  const db = bookingDb();
  const upsert = await db.from("doctor_branch_assignments").upsert(branchIds.map((branch_id) => ({ doctor_id: doctor.id, branch_id, is_active: true })), { onConflict: "doctor_id,branch_id" });
  if (upsert.error) throw new CrmSchedulingError(upsert.error.message);
  const existing = await db.from("doctor_branch_assignments").select("branch_id").eq("doctor_id", doctor.id); if (existing.error) throw new CrmSchedulingError(existing.error.message);
  const removed = (existing.data ?? []).map((row: {branch_id:string}) => row.branch_id).filter((id: string) => !branchIds.includes(id));
  if (removed.length) { const result = await db.from("doctor_branch_assignments").update({ is_active: false }).eq("doctor_id", doctor.id).in("branch_id", removed); if (result.error) throw new CrmSchedulingError(result.error.message); }
  const branchNames = snapshot.branches.filter((branch) => branchIds.includes(branch.id)).map((branch) => branch.nameEn);
  await audit(currentActor.id, "shared.doctor_branches.updated", doctor.id, { branch_ids: branchIds, branch_names: branchNames }); refreshScheduling();
  return { doctorName: doctor.nameEn, branchNames };
}

async function insertBlock(input: { blockType:string; title?:string|null; reason?:string|null; notes?:string|null; doctorId?:string|null; branchId?:string|null; roomId?:string|null; startsAt:string; endsAt:string; status?:string; active?:boolean }) {
  const start = splitDateTime(input.startsAt); const end = splitDateTime(input.endsAt); if (input.endsAt <= input.startsAt) throw new CrmSchedulingError("End must be after start.");
  const fullDay = start.time === "00:00" && end.time === "23:59";
  const result = await bookingDb().from("blocked_times").insert({
    block_date: start.date, end_date: end.date, start_time: fullDay ? null : start.time, end_time: fullDay ? null : end.time,
    doctor_id: input.doctorId || null, branch_id: input.branchId || null, room_id: input.roomId || null,
    reason: input.reason?.trim() || null, title: input.title?.trim() || null, notes: input.notes?.trim() || null,
    is_full_day: fullDay, block_type: input.blockType, status: input.status ?? "approved", is_active: input.active !== false,
  }).select("id").single<{id:string}>();
  if (result.error || !result.data) throw new CrmSchedulingError(result.error?.message ?? "Could not save blocked time.");
  return result.data.id;
}

export async function saveCrmClosure(input: { title: string; scope: string; branchId?: string; roomId?: string; startsAt: string; endsAt: string; notes?: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot();
  if (!input.title.trim()) throw new CrmSchedulingError("Closure title is required.");
  const branch = input.branchId ? named(snapshot.branches, input.branchId, "branch") : null; const room = input.roomId ? named(snapshot.rooms, input.roomId, "room", true) : null;
  const id = await insertBlock({ blockType: "closure", title: input.title, reason: input.title, notes: input.notes, branchId: branch?.id, roomId: room?.id, startsAt: input.startsAt, endsAt: input.endsAt, active: input.active });
  await audit(currentActor.id, "shared.closure.created", id, input); refreshScheduling();
}

export async function saveCrmScheduleException(input: { doctorId: string; branchId: string; roomId?: string; exceptionDate: string; startTime?: string; endTime?: string; exceptionType: string; reason?: string; active: boolean }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot(); const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = named(snapshot.branches, input.branchId, "branch");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.exceptionDate)) throw new CrmSchedulingError("Choose an exception date.");
  if (input.exceptionType !== "unavailable") throw new CrmSchedulingError("Shared exceptions currently support unavailable periods. Change the weekly schedule for added or modified hours.");
  const room = input.roomId ? named(snapshot.rooms.filter((item) => item.branchId === branch.id), input.roomId, "room", true) : null;
  const start = input.startTime || "00:00"; const end = input.endTime || "23:59";
  const id = await insertBlock({ blockType: "exception", title: input.exceptionType, reason: input.reason, doctorId: doctor.id, branchId: branch.id, roomId: room?.id, startsAt: `${input.exceptionDate}T${start}`, endsAt: `${input.exceptionDate}T${end}`, active: input.active });
  await audit(currentActor.id, "shared.exception.created", id, input); refreshScheduling();
}

export async function saveCrmTimeOff(input: { doctorId: string; branchId?: string; startsAt: string; endsAt: string; reason: string; notes?: string; status: string }) {
  const currentActor = await actor(); const snapshot = await crmSchedulingSnapshot(); const doctor = named(snapshot.doctors, input.doctorId, "doctor", true); const branch = input.branchId ? named(snapshot.branches, input.branchId, "branch") : null;
  if (!input.reason.trim()) throw new CrmSchedulingError("Reason is required.");
  const id = await insertBlock({ blockType: "time_off", title: "Doctor time off", reason: input.reason, notes: input.notes, doctorId: doctor.id, branchId: branch?.id, startsAt: input.startsAt, endsAt: input.endsAt, status: input.status });
  await audit(currentActor.id, "shared.time_off.created", id, input); refreshScheduling();
}
