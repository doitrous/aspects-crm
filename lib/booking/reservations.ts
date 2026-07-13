import "server-only";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import type { Reservation, ReservationStatus } from "@/lib/types";
import { isNewReservation } from "@/lib/reservationStatus";

/** Localized name pair from the booking lookup tables. */
interface NamePair {
  name_en?: string | null;
  name_ar?: string | null;
}

interface AppointmentRow {
  id: string;
  doctor_id: string | null;
  specialty_id: string | null;
  branch_id: string | null;
  service_id: string | null;
  patient_name: string;
  patient_age: number | null;
  patient_phone_country_code: string | null;
  patient_phone: string | null;
  patient_mrn?: string | null;
  patient_email: string | null;
  appointment_date: string;
  start_time: string;
  end_time: string;
  status: string;
  is_new_patient: boolean;
  notes: string | null;
  primary_complaint: string | null;
  referral_source: string | null;
  fee_at_booking: number | null;
  created_at: string;
  doctors: NamePair | NamePair[] | null;
  specialties: NamePair | NamePair[] | null;
  branches: NamePair | NamePair[] | null;
  services: NamePair | NamePair[] | null;
}

const BASE_SELECT =
  "id,doctor_id,specialty_id,branch_id,service_id,patient_name,patient_age,patient_phone_country_code,patient_phone,patient_email," +
  "appointment_date,start_time,end_time,status,is_new_patient,primary_complaint," +
  "referral_source,fee_at_booking,notes,created_at," +
  "doctors(name_en,name_ar),specialties(name_en,name_ar)," +
  "branches(name_en,name_ar),services(name_en,name_ar)";
let patientMrnColumnSupported: boolean | null = null;

const VALID_STATUS: ReservationStatus[] = [
  "reserved",
  "confirmed",
  "attended",
  "no_show",
  "cancelled",
  "rescheduled",
];

function toStatus(s: string): ReservationStatus {
  return (VALID_STATUS as string[]).includes(s) ? (s as ReservationStatus) : "reserved";
}

/** PostgREST returns embedded one-to-one relations as an object, but the typings
 *  allow an array; normalize and prefer the English label, fall back to Arabic. */
function label(rel: NamePair | NamePair[] | null): string | undefined {
  const n = Array.isArray(rel) ? rel[0] : rel;
  return n?.name_en ?? n?.name_ar ?? undefined;
}

function hhmm(t: string): string {
  return t.slice(0, 5);
}

function mapRow(r: AppointmentRow): Reservation {
  const cc = r.patient_phone_country_code ?? "";
  const phone = r.patient_phone ?? "";
  return {
    id: r.id,
    patientName: r.patient_name,
    patientPhone: `${cc}${phone}`.trim(),
    patientMrn: r.patient_mrn?.trim() || undefined,
    patientEmail: r.patient_email ?? undefined,
    patientAge: r.patient_age ?? undefined,
    doctorId: r.doctor_id ?? undefined,
    doctorName: label(r.doctors),
    specialtyId: r.specialty_id ?? undefined,
    specialtyName: label(r.specialties),
    branchId: r.branch_id ?? undefined,
    branchName: label(r.branches),
    serviceId: r.service_id ?? undefined,
    serviceName: label(r.services),
    date: r.appointment_date,
    startTime: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    status: toStatus(r.status),
    isNewPatient: Boolean(r.is_new_patient),
    notes: r.notes ?? undefined,
    primaryComplaint: r.primary_complaint ?? undefined,
    referralSource: r.referral_source ?? undefined,
    feeAtBooking: r.fee_at_booking ?? undefined,
    createdAt: r.created_at,
  };
}

export interface ReservationRange {
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
}

function reservationQuery(range: ReservationRange, includeMrn: boolean) {
  const select = includeMrn ? BASE_SELECT.replace("patient_email,", "patient_email,patient_mrn,") : BASE_SELECT;
  let query = bookingDb()
    .from("appointments")
    .select(select)
    .order("appointment_date", { ascending: false })
    .order("start_time", { ascending: true });
  if (range.from) query = query.gte("appointment_date", range.from);
  if (range.to) query = query.lte("appointment_date", range.to);
  return query;
}

function missingPatientMrnColumn(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error &&
    error.message?.includes("patient_mrn") &&
    (["42703", "PGRST204"].includes(error.code ?? "") || /column|schema cache|does not exist/i.test(error.message)),
  );
}

async function reservationRows(range: ReservationRange, from?: number, to?: number): Promise<AppointmentRow[]> {
  const includeMrn = patientMrnColumnSupported !== false;
  let query = reservationQuery(range, includeMrn);
  if (from !== undefined && to !== undefined) query = query.range(from, to);
  let result = await query;
  if (includeMrn && missingPatientMrnColumn(result.error)) {
    patientMrnColumnSupported = false;
    let fallback = reservationQuery(range, false);
    if (from !== undefined && to !== undefined) fallback = fallback.range(from, to);
    result = await fallback;
  } else if (!result.error && includeMrn) {
    patientMrnColumnSupported = true;
  }
  if (result.error) throw new Error(`getReservations: ${result.error.message}`);
  return (result.data ?? []) as unknown as AppointmentRow[];
}

/**
 * Live reservations from the booking platform, newest appointment first.
 * Returns `[]` when the integration is not configured so pages can render an
 * "unconfigured" empty state rather than crashing.
 */
export async function getReservations(range: ReservationRange = {}): Promise<Reservation[]> {
  if (!bookingConfigured()) return [];
  return (await reservationRows(range)).map(mapRow);
}

export interface ReservationPage {
  reservations: Reservation[];
  total: number;
  page: number;
  pageSize: number;
}

/** A bounded reservation page for the growing website-booking queue. */
export async function getReservationsPage(
  page = 1,
  pageSize = 100,
  range: ReservationRange = {},
): Promise<ReservationPage> {
  const safePage = Math.max(1, Math.floor(page));
  const safePageSize = Math.min(200, Math.max(1, Math.floor(pageSize)));
  if (!bookingConfigured()) return { reservations: [], total: 0, page: safePage, pageSize: safePageSize };
  const from = (safePage - 1) * safePageSize;
  // PostgREST only computes a count when requested on the select call, so run
  // a cheap head query in parallel with the embedded display rows.
  let countQuery = bookingDb().from("appointments").select("id", { count: "exact", head: true });
  if (range.from) countQuery = countQuery.gte("appointment_date", range.from);
  if (range.to) countQuery = countQuery.lte("appointment_date", range.to);
  const [rows, count] = await Promise.all([reservationRows(range, from, from + safePageSize - 1), countQuery]);
  if (count.error) throw new Error(`getReservationsPage(count): ${count.error.message}`);
  return {
    reservations: rows.map(mapRow),
    total: count.count ?? 0,
    page: safePage,
    pageSize: safePageSize,
  };
}

interface ReservationBadgeRow {
  id: string;
  status: string;
  created_at: string;
}

/**
 * Count only reservations that can qualify for the navigation badge. This
 * avoids loading every appointment plus all embedded lookup rows on every CRM
 * navigation. Dismissed IDs stay in the CRM database, so they are excluded
 * after the small candidate query.
 */
export async function getNewReservationCount(dismissedIds: ReadonlySet<string>): Promise<number> {
  if (!bookingConfigured()) return 0;
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const db = bookingDb();
  const [reserved, recent] = await Promise.all([
    db.from("appointments").select("id", { count: "exact", head: true }).eq("status", "reserved"),
    db
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("created_at", cutoff)
      .neq("status", "reserved"),
  ]);
  if (reserved.error) throw new Error(`getNewReservationCount(reserved): ${reserved.error.message}`);
  if (recent.error) throw new Error(`getNewReservationCount(recent): ${recent.error.message}`);

  let dismissedNew = 0;
  const dismissed = [...dismissedIds];
  for (let index = 0; index < dismissed.length; index += 200) {
    const { data, error } = await db
      .from("appointments")
      .select("id,status,created_at")
      .in("id", dismissed.slice(index, index + 200));
    if (error) throw new Error(`getNewReservationCount(dismissed): ${error.message}`);
    dismissedNew += ((data ?? []) as ReservationBadgeRow[]).filter((row) =>
      isNewReservation(toStatus(row.status), row.created_at),
    ).length;
  }
  return Math.max(0, (reserved.count ?? 0) + (recent.count ?? 0) - dismissedNew);
}
