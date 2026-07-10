"use server";

import { revalidatePath } from "next/cache";
import {
  availableBookingSlots,
  BookingError,
  createLeadBooking,
  updateReservationStatus,
  type BookingSlot,
} from "@/lib/booking/service";
import { notifyBookingCreated } from "@/lib/email/triggers";
import type { ReservationStatus } from "@/lib/types";

export interface BookingActionState {
  ok: string | null;
  error: string | null;
  appointmentId?: string;
  slots?: BookingSlot[];
  durationMinutes?: number;
}

function toState(err: unknown): BookingActionState {
  if (err instanceof BookingError) return { ok: null, error: err.message };
  throw err;
}

export async function getBookingSlotsAction(
  doctorId: string,
  branchId: string,
  date: string,
  serviceId?: string | null,
): Promise<BookingActionState> {
  try {
    const result = await availableBookingSlots({ doctorId, branchId, date, serviceId });
    return { ok: null, error: null, slots: result.slots, durationMinutes: result.durationMinutes };
  } catch (err) {
    return toState(err);
  }
}

export async function createLeadBookingAction(formData: FormData): Promise<BookingActionState> {
  try {
    const result = await createLeadBooking({
      leadId: String(formData.get("leadId") ?? ""),
      specialtyId: String(formData.get("specialtyId") ?? ""),
      doctorId: String(formData.get("doctorId") ?? ""),
      branchId: String(formData.get("branchId") ?? ""),
      serviceId: String(formData.get("serviceId") ?? "") || null,
      date: String(formData.get("date") ?? ""),
      startTime: String(formData.get("startTime") ?? ""),
      patientName: String(formData.get("patientName") ?? ""),
      phoneCountryCode: String(formData.get("phoneCountryCode") ?? "+20"),
      phoneNumber: String(formData.get("phoneNumber") ?? ""),
      patientEmail: String(formData.get("patientEmail") ?? "") || null,
      patientAge: String(formData.get("patientAge") ?? "") || null,
      isNewPatient: String(formData.get("isNewPatient") ?? "true") !== "false",
      primaryComplaint: String(formData.get("primaryComplaint") ?? "") || null,
      referralSource: String(formData.get("referralSource") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
      status: (String(formData.get("status") ?? "reserved") as ReservationStatus) || "reserved",
    });
    revalidatePath("/reservations");
    revalidatePath("/calendar");
    revalidatePath("/dashboard");
    revalidatePath("/leads");
    // Best-effort notification — an email failure must never fail the booking.
    try {
      await notifyBookingCreated({
        leadId: String(formData.get("leadId") ?? ""),
        patientName: String(formData.get("patientName") ?? ""),
        date: String(formData.get("date") ?? ""),
        startTime: String(formData.get("startTime") ?? ""),
        appointmentId: result.appointmentId,
      });
      revalidatePath("/emails");
    } catch (emailErr) {
      console.error("booking_created email dispatch failed", emailErr);
    }
    return { ok: "Booking created.", error: null, appointmentId: result.appointmentId };
  } catch (err) {
    return toState(err);
  }
}

export async function updateReservationStatusAction(
  appointmentId: string,
  status: ReservationStatus,
  leadId?: string,
  notes?: string,
): Promise<BookingActionState> {
  try {
    await updateReservationStatus({ appointmentId, status, leadId, notes });
    return { ok: "Booking status updated.", error: null };
  } catch (err) {
    return toState(err);
  }
}
