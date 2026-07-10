import "server-only";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import type { Reservation, ReservationStatus } from "@/lib/types";

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

const SELECT =
  "id,doctor_id,specialty_id,branch_id,service_id,patient_name,patient_age,patient_phone_country_code,patient_phone,patient_email," +
  "appointment_date,start_time,end_time,status,is_new_patient,primary_complaint," +
  "referral_source,fee_at_booking,notes,created_at," +
  "doctors(name_en,name_ar),specialties(name_en,name_ar)," +
  "branches(name_en,name_ar),services(name_en,name_ar)";

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

/**
 * Live reservations from the booking platform, newest appointment first.
 * Returns `[]` when the integration is not configured so pages can render an
 * "unconfigured" empty state rather than crashing.
 */
export async function getReservations(range: ReservationRange = {}): Promise<Reservation[]> {
  if (!bookingConfigured()) return [];
  let q = bookingDb()
    .from("appointments")
    .select(SELECT)
    .order("appointment_date", { ascending: false })
    .order("start_time", { ascending: true });
  if (range.from) q = q.gte("appointment_date", range.from);
  if (range.to) q = q.lte("appointment_date", range.to);
  const { data, error } = await q;
  if (error) throw new Error(`getReservations: ${error.message}`);
  return ((data ?? []) as unknown as AppointmentRow[]).map(mapRow);
}
