import "server-only";
import { revalidatePath } from "next/cache";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import { assertCan } from "@/lib/auth/permissions";
import { writeActor } from "@/lib/data/actor";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { BookingStatus, ReservationStatus } from "@/lib/types";

export class BookingError extends Error {}

export interface BookingName {
  id: string;
  nameEn: string;
  nameAr?: string;
}

export interface BookingSchedule {
  id: string;
  doctorId: string;
  branchId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  firstComeFirstServe: boolean;
  firstComeCapacity: number;
  active: boolean;
}

export interface BookingDoctor extends BookingName {
  specialtyId: string;
  titleEn?: string;
  schedules: BookingSchedule[];
}

export interface AdminDoctor extends BookingName {
  specialtyId: string | null;
  titleEn?: string;
  consultationFee?: number | null;
  active: boolean;
}

export interface BookingServiceItem extends BookingName {
  specialtyId: string;
  doctorId?: string | null;
  doctorIds: string[];
  durationMinutes: number;
  fee?: number | null;
}

export interface BookingCatalog {
  configured: boolean;
  specialties: BookingName[];
  doctors: BookingDoctor[];
  branches: BookingName[];
  services: BookingServiceItem[];
  settings: {
    bookingWindowDays: number;
    minNoticeHours: number;
    defaultDurationMinutes: number;
    firstComeDefaultCapacity: number;
  };
}

export interface FinancialDoctorCatalog {
  configured: boolean;
  doctors: AdminDoctor[];
  specialties: BookingName[];
}

export interface BookingBlockedTime {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  doctorId: string | null;
  doctorName: string | null;
  branchId: string | null;
  branchName: string | null;
  reason: string | null;
  fullDay: boolean;
}

export interface BookingSchedulingSnapshot extends BookingCatalog {
  blockedTimes: BookingBlockedTime[];
}

export interface BookingSlot {
  time: string;
  endTime: string;
  isFirstComeFirstServe?: boolean;
  capacity?: number;
  remainingCapacity?: number;
}

interface DbSchedule {
  id: string;
  doctor_id: string;
  branch_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  first_come_first_serve?: boolean | null;
  first_come_capacity?: number | null;
  is_active: boolean;
}

const ACTIVE_BOOKING_STATUSES: ReservationStatus[] = ["reserved", "confirmed"];
const STATUS_TO_BOOKING: Record<ReservationStatus, BookingStatus> = {
  reserved: "unconfirmed",
  confirmed: "confirmed",
  attended: "completed",
  no_show: "no_show",
  cancelled: "cancelled",
  rescheduled: "cancelled",
};

function parseIntSetting(value: unknown, fallback: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

function name(row: { name_en?: string | null; name_ar?: string | null }): string {
  return row.name_en?.trim() || row.name_ar?.trim() || "Unnamed";
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function datePlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hhmm(value: string): string {
  return value.slice(0, 5);
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = hhmm(start).split(":").map(Number);
  const [eh, em] = hhmm(end).split(":").map(Number);
  return Math.max(1, eh * 60 + em - (sh * 60 + sm));
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = hhmm(time).split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function normalizeTimeInput(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) throw new BookingError("Enter time as HH:MM.");
  return trimmed;
}

async function schedulingActor() {
  const actor = await writeActor();
  assertCan(actor.role, "financial.editRules");
  return actor;
}

function generateTimeSlots(start: string, end: string, duration: number): string[] {
  const slots: string[] = [];
  let current = hhmm(start);
  const endClock = hhmm(end);
  while (addMinutes(current, duration) <= endClock) {
    slots.push(current);
    current = addMinutes(current, duration);
  }
  return slots;
}

function dayOfWeek(ymd: string): number {
  return new Date(`${ymd}T00:00:00`).getDay();
}

function slotDateTime(ymd: string, time: string): Date {
  const d = new Date(`${ymd}T00:00:00`);
  const [h, m] = hhmm(time).split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function normalizePhone(cc?: string | null, phone?: string | null): string | null {
  const digits = `${cc ?? ""}${phone ?? ""}`.replace(/\D/g, "");
  return digits || null;
}

function toUiAppointmentStatus(status: string | null): ReservationStatus {
  if (
    status === "reserved" ||
    status === "confirmed" ||
    status === "attended" ||
    status === "no_show" ||
    status === "cancelled" ||
    status === "rescheduled"
  ) {
    return status;
  }
  return "reserved";
}

export function bookingStatusForReservation(status: ReservationStatus): BookingStatus {
  return STATUS_TO_BOOKING[status];
}

async function bookingSettings() {
  const { data, error } = await bookingDb()
    .from("clinic_settings")
    .select("key,value")
    .in("key", [
      "booking_window_days",
      "min_notice_hours",
      "default_appointment_duration_minutes",
      "first_come_default_daily_capacity",
    ]);
  if (error) throw new BookingError(`Could not read booking settings: ${error.message}`);
  const settings = Object.fromEntries(((data ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  return {
    bookingWindowDays: parseIntSetting(settings.booking_window_days, 90),
    minNoticeHours: parseIntSetting(settings.min_notice_hours, 6),
    defaultDurationMinutes: parseIntSetting(settings.default_appointment_duration_minutes, 20),
    firstComeDefaultCapacity: Math.max(1, parseIntSetting(settings.first_come_default_daily_capacity, 10)),
  };
}

export async function bookingCatalog(): Promise<BookingCatalog> {
  if (!bookingConfigured()) {
    return {
      configured: false,
      specialties: [],
      doctors: [],
      branches: [],
      services: [],
      settings: {
        bookingWindowDays: 90,
        minNoticeHours: 6,
        defaultDurationMinutes: 20,
        firstComeDefaultCapacity: 10,
      },
    };
  }

  const db = bookingDb();
  const [settings, specialtiesRes, doctorsRes, branchesRes, servicesRes] = await Promise.all([
    bookingSettings(),
    db.from("specialties").select("id,name_en,name_ar").eq("is_active", true).order("display_order"),
    db
      .from("doctors")
      .select("id,name_en,name_ar,title_en,specialty_id,doctor_schedule_templates(id,doctor_id,branch_id,day_of_week,start_time,end_time,first_come_first_serve,first_come_capacity,is_active)")
      .eq("is_active", true)
      .order("display_order"),
    db.from("branches").select("id,name_en,name_ar").eq("is_active", true).order("display_order"),
    db
      .from("services")
      .select("id,name_en,name_ar,specialty_id,doctor_id,duration_minutes,fee,service_doctors(doctor_id)")
      .eq("is_active", true)
      .eq("is_visible_to_patients", true)
      .order("display_order"),
  ]);

  for (const res of [specialtiesRes, doctorsRes, branchesRes, servicesRes]) {
    if (res.error) throw new BookingError(`Could not read booking catalog: ${res.error.message}`);
  }

  const specialties = ((specialtiesRes.data ?? []) as { id: string; name_en: string | null; name_ar: string | null }[])
    .map((r) => ({ id: r.id, nameEn: name(r), nameAr: r.name_ar ?? undefined }));
  const branches = ((branchesRes.data ?? []) as { id: string; name_en: string | null; name_ar: string | null }[])
    .map((r) => ({ id: r.id, nameEn: name(r), nameAr: r.name_ar ?? undefined }));
  const doctors = ((doctorsRes.data ?? []) as {
    id: string;
    name_en: string | null;
    name_ar: string | null;
    title_en: string | null;
    specialty_id: string;
    doctor_schedule_templates?: DbSchedule[] | null;
  }[]).map((r) => ({
    id: r.id,
    nameEn: name(r),
    nameAr: r.name_ar ?? undefined,
    titleEn: r.title_en ?? undefined,
    specialtyId: r.specialty_id,
    schedules: (r.doctor_schedule_templates ?? []).map((s) => ({
      id: s.id,
      doctorId: s.doctor_id,
      branchId: s.branch_id,
      dayOfWeek: s.day_of_week,
      startTime: hhmm(s.start_time),
      endTime: hhmm(s.end_time),
      firstComeFirstServe: Boolean(s.first_come_first_serve),
      firstComeCapacity: s.first_come_capacity ?? settings.firstComeDefaultCapacity,
      active: Boolean(s.is_active),
    })),
  }));
  const services = ((servicesRes.data ?? []) as {
    id: string;
    name_en: string | null;
    name_ar: string | null;
    specialty_id: string;
    doctor_id: string | null;
    duration_minutes: number | null;
    fee: number | null;
    service_doctors?: { doctor_id: string }[] | null;
  }[]).map((r) => ({
    id: r.id,
    nameEn: name(r),
    nameAr: r.name_ar ?? undefined,
    specialtyId: r.specialty_id,
    doctorId: r.doctor_id,
    doctorIds: (r.service_doctors ?? []).map((d) => d.doctor_id),
    durationMinutes: r.duration_minutes ?? settings.defaultDurationMinutes,
    fee: r.fee,
  }));

  return { configured: true, specialties, doctors, branches, services, settings };
}

export async function financialDoctorCatalog(): Promise<FinancialDoctorCatalog> {
  if (!bookingConfigured()) return { configured: false, doctors: [], specialties: [] };
  const db = bookingDb();
  const [specialtiesRes, doctorsRes] = await Promise.all([
    db.from("specialties").select("id,name_en,name_ar").order("display_order"),
    db
      .from("doctors")
      .select("id,name_en,name_ar,title_en,specialty_id,consultation_fee,is_active")
      .order("display_order"),
  ]);
  for (const res of [specialtiesRes, doctorsRes]) {
    if (res.error) throw new BookingError(`Could not read Admin doctor catalog: ${res.error.message}`);
  }
  return {
    configured: true,
    specialties: ((specialtiesRes.data ?? []) as { id: string; name_en: string | null; name_ar: string | null }[])
      .map((r) => ({ id: r.id, nameEn: name(r), nameAr: r.name_ar ?? undefined })),
    doctors: ((doctorsRes.data ?? []) as {
      id: string;
      name_en: string | null;
      name_ar: string | null;
      title_en: string | null;
      specialty_id: string | null;
      consultation_fee: number | null;
      is_active: boolean | null;
    }[]).map((r) => ({
      id: r.id,
      nameEn: name(r),
      nameAr: r.name_ar ?? undefined,
      titleEn: r.title_en ?? undefined,
      specialtyId: r.specialty_id,
      consultationFee: r.consultation_fee,
      active: Boolean(r.is_active),
    })),
  };
}

export async function createFinancialDoctor(input: {
  nameEn: string;
  nameAr?: string | null;
  titleEn?: string | null;
  specialtyId: string;
  consultationFee?: number | null;
}): Promise<{ id: string }> {
  const actor = await schedulingActor();
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  const nameEn = input.nameEn.trim();
  if (!nameEn) throw new BookingError("Doctor name is required.");
  if (!input.specialtyId) throw new BookingError("Choose a specialty.");

  const patch = {
    name_en: nameEn,
    name_ar: input.nameAr?.trim() || null,
    title_en: input.titleEn?.trim() || null,
    specialty_id: input.specialtyId,
    consultation_fee: input.consultationFee ?? null,
    is_active: false,
    display_order: 999,
  };
  const { data, error } = await bookingDb()
    .from("doctors")
    .insert(patch)
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw new BookingError(error?.message ?? "Could not add doctor.");
  await logSchedulingChange(
    actor.id,
    "booking.doctor_created_for_finance",
    "Doctor created for financial record-keeping",
    {},
    { id: data.id, ...patch, public_booking_default: "inactive_not_bookable" },
  );
  revalidatePath("/settings");
  revalidatePath("/financial/settings");
  return { id: data.id };
}

export async function bookingSchedulingSnapshot(): Promise<BookingSchedulingSnapshot> {
  const catalog = await bookingCatalog();
  if (!catalog.configured) return { ...catalog, blockedTimes: [] };

  const db = bookingDb();
  const { data, error } = await db
    .from("blocked_times")
    .select("id,block_date,start_time,end_time,doctor_id,branch_id,reason,is_full_day")
    .gte("block_date", todayYmd())
    .order("block_date", { ascending: true })
    .limit(40);
  if (error) throw new BookingError(`Could not read blocked times: ${error.message}`);

  const doctorById = new Map(catalog.doctors.map((d) => [d.id, d]));
  const branchById = new Map(catalog.branches.map((b) => [b.id, b]));

  return {
    ...catalog,
    blockedTimes: ((data ?? []) as {
      id: string;
      block_date: string;
      start_time: string | null;
      end_time: string | null;
      doctor_id: string | null;
      branch_id: string | null;
      reason: string | null;
      is_full_day: boolean;
    }[]).map((row) => ({
      id: row.id,
      date: row.block_date,
      startTime: row.start_time ? hhmm(row.start_time) : null,
      endTime: row.end_time ? hhmm(row.end_time) : null,
      doctorId: row.doctor_id,
      doctorName: row.doctor_id ? doctorById.get(row.doctor_id)?.nameEn ?? null : null,
      branchId: row.branch_id,
      branchName: row.branch_id ? branchById.get(row.branch_id)?.nameEn ?? null : null,
      reason: row.reason,
      fullDay: row.is_full_day,
    })),
  };
}

export async function updateScheduleTemplate(input: {
  scheduleId: string;
  active: boolean;
  startTime: string;
  endTime: string;
  firstComeFirstServe: boolean;
  firstComeCapacity: number;
}): Promise<void> {
  const actor = await schedulingActor();
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  const firstComeCapacity = Math.max(1, Math.floor(Number(input.firstComeCapacity || 1)));
  const patch = {
    is_active: input.active,
    start_time: normalizeTimeInput(input.startTime),
    end_time: normalizeTimeInput(input.endTime),
    first_come_first_serve: input.firstComeFirstServe,
    first_come_capacity: firstComeCapacity,
  };
  if (patch.end_time <= patch.start_time) throw new BookingError("End time must be after start time.");

  const db = bookingDb();
  const { data: oldRow, error: oldError } = await db
    .from("doctor_schedule_templates")
    .select("id,doctor_id,branch_id,day_of_week,start_time,end_time,is_active,first_come_first_serve,first_come_capacity")
    .eq("id", input.scheduleId)
    .maybeSingle();
  if (oldError) throw new BookingError(`Could not read schedule: ${oldError.message}`);
  if (!oldRow) throw new BookingError("Schedule row not found.");

  const { error } = await db.from("doctor_schedule_templates").update(patch).eq("id", input.scheduleId);
  if (error) throw new BookingError(`Could not update schedule: ${error.message}`);

  await logSchedulingChange(actor.id, "booking.schedule_updated", "Doctor schedule updated", oldRow, patch);
  revalidatePath("/settings");
  revalidatePath("/calendar");
  revalidatePath("/reservations");
}

export async function createBlockedTime(input: {
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  doctorId?: string | null;
  branchId?: string | null;
  fullDay: boolean;
  reason?: string | null;
}): Promise<void> {
  const actor = await schedulingActor();
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new BookingError("Choose a valid date.");
  if (!input.reason?.trim()) throw new BookingError("Enter a reason for the block.");

  const patch = {
    block_date: input.date,
    start_time: input.fullDay ? null : normalizeTimeInput(input.startTime ?? ""),
    end_time: input.fullDay ? null : normalizeTimeInput(input.endTime ?? ""),
    doctor_id: input.doctorId || null,
    branch_id: input.branchId || null,
    reason: input.reason.trim(),
    is_full_day: input.fullDay,
  };
  if (!patch.is_full_day && patch.end_time! <= patch.start_time!) {
    throw new BookingError("End time must be after start time.");
  }

  const { data, error } = await bookingDb().from("blocked_times").insert(patch).select("id").single<{ id: string }>();
  if (error || !data) throw new BookingError(error?.message ?? "Could not add blocked time.");
  await logSchedulingChange(actor.id, "booking.blocked_time_created", "Blocked time created", {}, { id: data.id, ...patch });
  revalidatePath("/settings");
  revalidatePath("/calendar");
}

export async function deleteBlockedTime(id: string): Promise<void> {
  const actor = await schedulingActor();
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  const db = bookingDb();
  const { data: oldRow, error: oldError } = await db.from("blocked_times").select("*").eq("id", id).maybeSingle();
  if (oldError) throw new BookingError(`Could not read blocked time: ${oldError.message}`);
  if (!oldRow) throw new BookingError("Blocked time not found.");
  const { error } = await db.from("blocked_times").delete().eq("id", id);
  if (error) throw new BookingError(`Could not remove blocked time: ${error.message}`);
  await logSchedulingChange(actor.id, "booking.blocked_time_deleted", "Blocked time removed", oldRow, {});
  revalidatePath("/settings");
  revalidatePath("/calendar");
}

async function logSchedulingChange(
  actorId: string,
  action: string,
  title: string,
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
) {
  const { error } = await supabaseAdmin().from("audit_logs").insert({
    actor_user_id: actorId,
    action,
    entity_type: "booking_schedule",
    entity_id: null,
    old_values: oldValues,
    new_values: newValues,
    metadata: { title },
  });
  if (error) throw new BookingError(`Could not write scheduling audit log: ${error.message}`);
}

export async function availableBookingSlots(params: {
  doctorId: string;
  branchId: string;
  date: string;
  serviceId?: string | null;
}): Promise<{ slots: BookingSlot[]; durationMinutes: number }> {
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  if (!params.doctorId || !params.branchId || !params.date) {
    throw new BookingError("Choose doctor, branch, and date.");
  }

  const db = bookingDb();
  const settings = await bookingSettings();
  if (params.date < todayYmd() || params.date > datePlusDays(settings.bookingWindowDays)) {
    return { slots: [], durationMinutes: settings.defaultDurationMinutes };
  }

  let durationMinutes = settings.defaultDurationMinutes;
  if (params.serviceId) {
    const { data: service, error } = await db
      .from("services")
      .select("duration_minutes")
      .eq("id", params.serviceId)
      .maybeSingle<{ duration_minutes: number | null }>();
    if (error) throw new BookingError(`Could not read selected service: ${error.message}`);
    durationMinutes = service?.duration_minutes ?? durationMinutes;
  }

  const [schedulesRes, bookingsRes, blockedRes] = await Promise.all([
    db
      .from("doctor_schedule_templates")
      .select("id,doctor_id,branch_id,day_of_week,start_time,end_time,first_come_first_serve,first_come_capacity,is_active")
      .eq("doctor_id", params.doctorId)
      .eq("branch_id", params.branchId)
      .eq("is_active", true),
    db
      .from("appointments")
      .select("doctor_id,branch_id,appointment_date,start_time,end_time,status")
      .eq("doctor_id", params.doctorId)
      .eq("appointment_date", params.date)
      .in("status", ACTIVE_BOOKING_STATUSES),
    db.from("blocked_times").select("*").eq("block_date", params.date),
  ]);
  for (const res of [schedulesRes, bookingsRes, blockedRes]) {
    if (res.error) throw new BookingError(`Could not read availability: ${res.error.message}`);
  }

  const schedule = ((schedulesRes.data ?? []) as DbSchedule[]).find(
    (s) => s.doctor_id === params.doctorId && s.branch_id === params.branchId && s.day_of_week === dayOfWeek(params.date),
  );
  if (!schedule) return { slots: [], durationMinutes };

  const blocked = (blockedRes.data ?? []) as {
    block_date: string;
    start_time: string | null;
    end_time: string | null;
    doctor_id: string | null;
    branch_id: string | null;
    is_full_day: boolean;
  }[];
  if (
    blocked.some(
      (b) =>
        b.block_date === params.date &&
        b.is_full_day &&
        (!b.doctor_id || b.doctor_id === params.doctorId) &&
        (!b.branch_id || b.branch_id === params.branchId),
    )
  ) {
    return { slots: [], durationMinutes };
  }

  const partialBlocks = blocked.filter(
    (b) =>
      b.block_date === params.date &&
      !b.is_full_day &&
      (!b.doctor_id || b.doctor_id === params.doctorId) &&
      (!b.branch_id || b.branch_id === params.branchId),
  );
  const activeBookings = ((bookingsRes.data ?? []) as {
    doctor_id: string;
    branch_id: string;
    appointment_date: string;
    start_time: string;
    end_time: string;
    status: string;
  }[]).filter((a) => ACTIVE_BOOKING_STATUSES.includes(toUiAppointmentStatus(a.status)));

  const cutoff = new Date(Date.now() + settings.minNoticeHours * 60 * 60 * 1000);

  if (schedule.first_come_first_serve) {
    const start = hhmm(schedule.start_time);
    const end = hhmm(schedule.end_time);
    if (slotDateTime(params.date, end) < cutoff) return { slots: [], durationMinutes };
    const blockedSession = partialBlocks.some((b) => b.start_time && b.end_time && start < b.end_time && end > b.start_time);
    if (blockedSession) return { slots: [], durationMinutes };
    const capacity = Math.max(1, schedule.first_come_capacity ?? settings.firstComeDefaultCapacity);
    const bookedCount = activeBookings.filter(
      (a) => a.branch_id === params.branchId && hhmm(a.start_time) >= start && hhmm(a.end_time) <= end,
    ).length;
    const remainingCapacity = capacity - bookedCount;
    return {
      durationMinutes,
      slots: remainingCapacity > 0 ? [{ time: start, endTime: end, isFirstComeFirstServe: true, capacity, remainingCapacity }] : [],
    };
  }

  const slots = generateTimeSlots(schedule.start_time, schedule.end_time, durationMinutes).filter((time) => {
    const end = addMinutes(time, durationMinutes);
    if (slotDateTime(params.date, time) < cutoff) return false;
    if (activeBookings.some((a) => time < hhmm(a.end_time) && end > hhmm(a.start_time))) return false;
    if (partialBlocks.some((b) => b.start_time && b.end_time && time < hhmm(b.end_time) && end > hhmm(b.start_time))) return false;
    return true;
  });
  return { durationMinutes, slots: slots.map((time) => ({ time, endTime: addMinutes(time, durationMinutes) })) };
}

async function crmLeadById(leadId: string) {
  const { data, error } = await supabaseAdmin()
    .from("leads")
    .select("id,lead_id,name,phone_country_code,phone_number,normalized_phone,service_name,status,metadata,booking_appointment_id")
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new BookingError(`Could not read CRM lead: ${error.message}`);
  if (!data) throw new BookingError("Lead not found.");
  return data as {
    id: string;
    lead_id: string;
    name: string | null;
    phone_country_code: string | null;
    phone_number: string | null;
    normalized_phone: string | null;
    service_name: string | null;
    status: string | null;
    metadata: Record<string, unknown> | null;
    booking_appointment_id: string | null;
  };
}

async function logLeadEvent(params: {
  leadUid: string;
  actorId: string | null;
  action: string;
  title: string;
  body?: string | null;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
}) {
  const db = supabaseAdmin();
  const [auditResult, timelineResult] = await Promise.all([
    db.from("audit_logs").insert({
      actor_user_id: params.actorId,
      action: params.action,
      entity_type: "lead",
      entity_id: params.leadUid,
      old_values: params.oldValues ?? {},
      new_values: params.newValues ?? {},
      metadata: {},
    }),
    db.from("lead_timeline_events").insert({
      lead_id: params.leadUid,
      event_type: params.action,
      title: params.title,
      body: params.body ?? null,
      actor_user_id: params.actorId,
      metadata: params.newValues ?? {},
    }),
  ]);
  if (auditResult.error) throw new BookingError(`Could not write audit log: ${auditResult.error.message}`);
  if (timelineResult.error) throw new BookingError(`Could not write lead log: ${timelineResult.error.message}`);
}

export async function createLeadBooking(input: {
  leadId: string;
  specialtyId: string;
  doctorId: string;
  branchId: string;
  serviceId?: string | null;
  date: string;
  startTime: string;
  patientName: string;
  phoneCountryCode: string;
  phoneNumber: string;
  patientEmail?: string | null;
  patientAge?: string | null;
  isNewPatient: boolean;
  primaryComplaint?: string | null;
  referralSource?: string | null;
  notes?: string | null;
  status?: ReservationStatus;
}): Promise<{ appointmentId: string }> {
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  const actor = await writeActor();
  const lead = await crmLeadById(input.leadId);
  if (!input.patientName.trim() || !input.phoneNumber.trim()) throw new BookingError("Patient name and phone are required.");
  const { slots, durationMinutes } = await availableBookingSlots({
    doctorId: input.doctorId,
    branchId: input.branchId,
    date: input.date,
    serviceId: input.serviceId,
  });
  const selected = slots.find((s) => s.time === input.startTime);
  if (!selected) throw new BookingError("This time slot is no longer available.");

  const db = bookingDb();
  let feeAtBooking: number | null = null;
  if (input.serviceId) {
    const { data: svc, error } = await db
      .from("services")
      .select("duration_minutes,fee,specialty_id,doctor_id,service_doctors(doctor_id)")
      .eq("id", input.serviceId)
      .maybeSingle();
    if (error) throw new BookingError(`Could not read service: ${error.message}`);
    const row = svc as { fee?: number | null; specialty_id?: string; doctor_id?: string | null; service_doctors?: { doctor_id: string }[] } | null;
    const assigned = row?.service_doctors ?? [];
    const allowedDoctor = assigned.length > 0
      ? assigned.some((r) => r.doctor_id === input.doctorId)
      : !row?.doctor_id || row.doctor_id === input.doctorId;
    if (!row || row.specialty_id !== input.specialtyId || !allowedDoctor) {
      throw new BookingError("This service is not available for the selected doctor.");
    }
    feeAtBooking = row.fee ?? null;
  }
  if (!feeAtBooking) {
    const { data: doc, error } = await db.from("doctors").select("consultation_fee").eq("id", input.doctorId).maybeSingle();
    if (error) throw new BookingError(`Could not read doctor fee: ${error.message}`);
    feeAtBooking = (doc as { consultation_fee?: number | null } | null)?.consultation_fee ?? null;
  }

  const normalizedPhone = input.phoneNumber.replace(/\D/g, "");
  const status = input.status ?? "reserved";
  const { data: appointment, error } = await db
    .from("appointments")
    .insert({
      patient_name: input.patientName.trim(),
      patient_age: input.patientAge ? Number.parseInt(input.patientAge, 10) : null,
      patient_phone_country_code: input.phoneCountryCode || "+20",
      patient_phone: normalizedPhone,
      patient_email: input.patientEmail?.trim() || null,
      doctor_id: input.doctorId,
      specialty_id: input.specialtyId,
      branch_id: input.branchId,
      service_id: input.serviceId || null,
      appointment_date: input.date,
      start_time: input.startTime,
      end_time: selected.endTime,
      duration_at_booking: selected.isFirstComeFirstServe ? minutesBetween(selected.time, selected.endTime) : durationMinutes,
      fee_at_booking: feeAtBooking,
      primary_complaint: input.primaryComplaint?.trim() || null,
      referral_source: input.referralSource?.trim() || null,
      is_new_patient: input.isNewPatient,
      notes: input.notes?.trim() || null,
      status,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !appointment) {
    const message = error?.message ?? "Booking failed.";
    if (message.includes("overlapping") || message.includes("capacity") || error?.code === "23514") {
      throw new BookingError("This time slot is no longer available.");
    }
    throw new BookingError(message);
  }

  await db.from("appointment_status_history").insert({
    appointment_id: appointment.id,
    previous_status: null,
    new_status: status,
    notes: `Created from CRM lead ${input.leadId}`,
  });

  const now = new Date().toISOString();
  const bookingMeta = {
    ...(lead.metadata ?? {}),
    booking_appointment_id: appointment.id,
    appointment_date: input.date,
    start_time: input.startTime,
    booking_status: status,
  };
  const { error: leadError } = await supabaseAdmin()
    .from("leads")
    .update({
      booking_appointment_id: appointment.id,
      status: "booked",
      phone_country_code: input.phoneCountryCode || lead.phone_country_code,
      phone_number: normalizedPhone || lead.phone_number,
      normalized_phone: normalizePhone(input.phoneCountryCode, normalizedPhone) ?? lead.normalized_phone,
      metadata: bookingMeta,
      updated_at: now,
    })
    .eq("id", lead.id);
  if (leadError) throw new BookingError(`Appointment was created, but CRM lead link failed: ${leadError.message}`);

  await logLeadEvent({
    leadUid: lead.id,
    actorId: actor.id,
    action: "lead.booking_created",
    title: "Booking created",
    body: `${input.date} ${input.startTime}`,
    oldValues: { booking_appointment_id: lead.booking_appointment_id, status: lead.status },
    newValues: { booking_appointment_id: appointment.id, status: "booked", booking_status: status },
  });

  revalidatePath(`/leads/${input.leadId}`);
  revalidatePath("/calendar");
  revalidatePath("/reservations");
  revalidatePath("/dashboard");
  return { appointmentId: appointment.id };
}

export async function updateReservationStatus(input: {
  appointmentId: string;
  status: ReservationStatus;
  leadId?: string;
  notes?: string;
}): Promise<void> {
  if (!bookingConfigured()) throw new BookingError("Booking platform is not configured.");
  const actor = await writeActor();
  const db = bookingDb();
  const { data: current, error: loadError } = await db
    .from("appointments")
    .select("id,status")
    .eq("id", input.appointmentId)
    .maybeSingle<{ id: string; status: string | null }>();
  if (loadError) throw new BookingError(`Could not read appointment: ${loadError.message}`);
  if (!current) throw new BookingError("Appointment not found.");
  const previous = toUiAppointmentStatus(current.status);
  if (previous === input.status) return;

  const { error } = await db.from("appointments").update({ status: input.status }).eq("id", input.appointmentId);
  if (error) throw new BookingError(`Could not update appointment status: ${error.message}`);
  const { error: historyError } = await db.from("appointment_status_history").insert({
    appointment_id: input.appointmentId,
    previous_status: previous,
    new_status: input.status,
    changed_by: actor.id,
    notes: input.notes?.trim() || `Status changed from CRM to ${input.status}`,
  });
  if (historyError) throw new BookingError(`Could not write booking status history: ${historyError.message}`);

  let lead = input.leadId ? await crmLeadById(input.leadId) : null;
  if (!lead) {
    const { data } = await supabaseAdmin()
      .from("leads")
      .select("id,lead_id,name,phone_country_code,phone_number,normalized_phone,service_name,status,metadata,booking_appointment_id")
      .eq("booking_appointment_id", input.appointmentId)
      .maybeSingle();
    lead = data as Awaited<ReturnType<typeof crmLeadById>> | null;
  }
  if (lead) {
    const nextLeadStatus = input.status === "confirmed" || input.status === "attended" ? "booked" : lead.status;
    const { error: leadError } = await supabaseAdmin()
      .from("leads")
      .update({
        status: nextLeadStatus,
        metadata: { ...(lead.metadata ?? {}), booking_status: input.status },
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead.id);
    if (leadError) throw new BookingError(`Could not update CRM lead booking status: ${leadError.message}`);
    await logLeadEvent({
      leadUid: lead.id,
      actorId: actor.id,
      action: "lead.booking_status_changed",
      title: "Booking status changed",
      body: `${previous} -> ${input.status}`,
      oldValues: { booking_status: previous },
      newValues: { booking_status: input.status, appointment_id: input.appointmentId },
    });
    revalidatePath(`/leads/${lead.lead_id}`);
  }
  revalidatePath("/calendar");
  revalidatePath("/reservations");
  revalidatePath("/dashboard");
}
