"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createLeadBookingAction,
  getBookingSlotsAction,
  updateReservationStatusAction,
} from "@/app/(crm)/booking/actions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { BOOKING_META } from "@/lib/badges";
import { formatClock, formatDateTime } from "@/lib/format";
import type { Booking, Lead, ReservationStatus } from "@/lib/types";

interface BookingName {
  id: string;
  nameEn: string;
  nameAr?: string;
}

interface BookingSchedule {
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

interface BookingDoctor extends BookingName {
  specialtyId: string;
  titleEn?: string;
  schedules: BookingSchedule[];
}

interface BookingServiceItem extends BookingName {
  specialtyId: string;
  doctorId?: string | null;
  doctorIds: string[];
  durationMinutes: number;
  fee?: number | null;
}

interface BookingCatalog {
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

interface BookingSlot {
  time: string;
  endTime: string;
  isFirstComeFirstServe?: boolean;
  capacity?: number;
  remainingCapacity?: number;
}

const RESERVATION_STATUS: { value: ReservationStatus; label: string }[] = [
  { value: "reserved", label: "Reserved" },
  { value: "confirmed", label: "Confirmed" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No-show" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
];

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fieldClass(): string {
  return "h-9 rounded-control border border-line bg-panel px-2 text-[12.5px] text-ink-700";
}

export function BookingTab({
  lead,
  bookings,
  catalog,
}: {
  lead: Lead;
  bookings: Booking[];
  catalog: BookingCatalog;
}) {
  const [specialtyId, setSpecialtyId] = useState(lead.specialtyId ?? catalog.specialties[0]?.id ?? "");
  const doctorsForSpecialty = useMemo(
    () => catalog.doctors.filter((d) => !specialtyId || d.specialtyId === specialtyId),
    [catalog.doctors, specialtyId],
  );
  const [doctorId, setDoctorId] = useState(lead.doctorId ?? doctorsForSpecialty[0]?.id ?? "");
  const selectedDoctor = catalog.doctors.find((d) => d.id === doctorId);
  const branchIds = new Set((selectedDoctor?.schedules ?? []).filter((s) => s.active).map((s) => s.branchId));
  const branches = catalog.branches.filter((b) => branchIds.has(b.id));
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(today());
  const [slots, setSlots] = useState<BookingSlot[]>([]);
  const [slot, setSlot] = useState("");
  const [patientName, setPatientName] = useState(lead.patientName);
  const [phoneCountryCode, setPhoneCountryCode] = useState("+20");
  const [phoneNumber, setPhoneNumber] = useState(digits(lead.phone).replace(/^20/, ""));
  const [isNewPatient, setIsNewPatient] = useState(lead.patientType !== "returning");
  const [referralSource, setReferralSource] = useState("");
  const [primaryComplaint, setPrimaryComplaint] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<ReservationStatus>("reserved");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});

  const services = useMemo(
    () =>
      catalog.services.filter((s) => {
        if (s.specialtyId !== specialtyId) return false;
        if (s.doctorIds.length > 0) return s.doctorIds.includes(doctorId);
        return !s.doctorId || s.doctorId === doctorId;
      }),
    [catalog.services, doctorId, specialtyId],
  );

  function loadSlots() {
    startTransition(async () => {
      setMessage({});
      setSlot("");
      const result = await getBookingSlotsAction(doctorId, branchId, date, serviceId || null);
      if (result.error) {
        setSlots([]);
        setMessage({ error: result.error });
        return;
      }
      setSlots(result.slots ?? []);
      if ((result.slots ?? []).length === 0) setMessage({ error: "No live slots are available for this selection." });
    });
  }

  function createBooking() {
    const fd = new FormData();
    fd.set("leadId", lead.id);
    fd.set("specialtyId", specialtyId);
    fd.set("doctorId", doctorId);
    fd.set("branchId", branchId);
    fd.set("serviceId", serviceId);
    fd.set("date", date);
    fd.set("startTime", slot);
    fd.set("patientName", patientName);
    fd.set("phoneCountryCode", phoneCountryCode);
    fd.set("phoneNumber", phoneNumber);
    fd.set("isNewPatient", String(isNewPatient));
    fd.set("referralSource", referralSource);
    fd.set("primaryComplaint", primaryComplaint);
    fd.set("notes", notes);
    fd.set("status", status);
    startTransition(async () => {
      setMessage({});
      const result = await createLeadBookingAction(fd);
      if (result.error) setMessage({ error: result.error });
      else setMessage({ ok: result.ok ?? "Booking created." });
    });
  }

  function changeStatus(appointmentId: string, next: ReservationStatus) {
    startTransition(async () => {
      setMessage({});
      const result = await updateReservationStatusAction(appointmentId, next, lead.id);
      if (result.error) setMessage({ error: result.error });
      else setMessage({ ok: result.ok ?? "Booking status updated." });
    });
  }

  if (!catalog.configured) {
    return (
      <div className="p-5">
        <EmptyState
          title="Booking source is not configured"
          hint="The CRM needs BOOKING_SUPABASE_URL and BOOKING_SUPABASE_SERVICE_ROLE_KEY on the server to read and write the live booking system."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5">
      {message.error && (
        <div className="rounded-control bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger">
          {message.error}
        </div>
      )}
      {message.ok && (
        <div className="rounded-control bg-[#ecfdf3] px-3 py-2 text-[12px] font-medium text-success">
          {message.ok}
        </div>
      )}

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Existing bookings</div>
        {bookings.length === 0 ? (
          <div className="rounded-card border border-line p-3 text-[12px] text-ink-400">
            No appointments are linked to this lead yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bookings.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line p-3">
                <div>
                  <div className="font-mono text-[10.5px] text-ink-400">{b.id}</div>
                  <div className="text-[13px] font-semibold text-ink-900">{formatDateTime(b.startAt)}</div>
                  <div className="text-[11.5px] text-ink-400">
                    {b.doctorId} · {b.branch} · {b.durationMin}m
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge style={BOOKING_META[b.status]} />
                  <select
                    disabled={pending}
                    value={
                      b.status === "unconfirmed"
                        ? "reserved"
                        : b.status === "completed"
                          ? "attended"
                          : b.status === "no_show"
                            ? "no_show"
                            : b.status === "cancelled"
                              ? "cancelled"
                              : "confirmed"
                    }
                    onChange={(e) => changeStatus(b.id, e.target.value as ReservationStatus)}
                    className={fieldClass()}
                  >
                    {RESERVATION_STATUS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Create booking</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-ink-600">
            Specialty
            <select
              value={specialtyId}
              onChange={(e) => {
                const nextSpecialty = e.target.value;
                setSpecialtyId(nextSpecialty);
                const firstDoctor = catalog.doctors.find((d) => d.specialtyId === nextSpecialty);
                setDoctorId(firstDoctor?.id ?? "");
                setBranchId(firstDoctor?.schedules.find((s) => s.active)?.branchId ?? "");
                setServiceId("");
                setSlots([]);
              }}
              className={`mt-1 w-full ${fieldClass()}`}
            >
              {catalog.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Doctor
            <select
              value={doctorId}
              onChange={(e) => {
                const nextDoctor = catalog.doctors.find((d) => d.id === e.target.value);
                setDoctorId(e.target.value);
                setBranchId(nextDoctor?.schedules.find((s) => s.active)?.branchId ?? "");
                setSlots([]);
              }}
              className={`mt-1 w-full ${fieldClass()}`}
            >
              {doctorsForSpecialty.map((d) => <option key={d.id} value={d.id}>{d.nameEn}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Branch
            <select value={branchId} onChange={(e) => { setBranchId(e.target.value); setSlots([]); }} className={`mt-1 w-full ${fieldClass()}`}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.nameEn}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Service / visit type
            <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlots([]); }} className={`mt-1 w-full ${fieldClass()}`}>
              <option value="">General consultation</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameEn} ({s.durationMinutes}m{s.fee ? ` · ${s.fee} EGP` : ""})
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Date
            <input
              type="date"
              min={today()}
              max={addDays(catalog.settings.bookingWindowDays)}
              value={date}
              onChange={(e) => { setDate(e.target.value); setSlots([]); }}
              className={`mt-1 w-full ${fieldClass()}`}
            />
          </label>
          <div className="flex items-end">
            <button
              type="button"
              disabled={pending || !doctorId || !branchId || !date}
              onClick={loadSlots}
              className="h-9 rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
            >
              Load live slots
            </button>
          </div>
        </div>

        {slots.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {slots.map((s) => (
              <button
                key={s.time}
                type="button"
                disabled={pending}
                onClick={() => setSlot(s.time)}
                className={
                  "rounded-control border px-2 py-2 text-[12px] font-semibold " +
                  (slot === s.time
                    ? "border-primary bg-primary text-white"
                    : "border-line bg-panel text-ink-700 hover:border-primary hover:text-primary")
                }
              >
                {s.isFirstComeFirstServe ? (
                  <span className="block">
                    First-come
                    <span className="block text-[10px] opacity-80">
                      {formatClock(s.time)} · {s.remainingCapacity} left
                    </span>
                  </span>
                ) : (
                  formatClock(s.time)
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">Patient details</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-ink-600">
            Patient name
            <input value={patientName} onChange={(e) => setPatientName(e.target.value)} className={`mt-1 w-full ${fieldClass()}`} />
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Phone
            <div className="mt-1 flex gap-2">
              <input value={phoneCountryCode} onChange={(e) => setPhoneCountryCode(e.target.value)} className={`${fieldClass()} w-20`} />
              <input value={phoneNumber} onChange={(e) => setPhoneNumber(digits(e.target.value))} className={`flex-1 ${fieldClass()}`} />
            </div>
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Patient type
            <select value={String(isNewPatient)} onChange={(e) => setIsNewPatient(e.target.value === "true")} className={`mt-1 w-full ${fieldClass()}`}>
              <option value="true">New patient</option>
              <option value="false">Follow-up / returning</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-600">
            Initial status
            <select value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus)} className={`mt-1 w-full ${fieldClass()}`}>
              <option value="reserved">Reserved</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink-600 sm:col-span-2">
            Referral source
            <input value={referralSource} onChange={(e) => setReferralSource(e.target.value)} className={`mt-1 w-full ${fieldClass()}`} />
          </label>
          <label className="text-[12px] font-semibold text-ink-600 sm:col-span-2">
            Primary complaint
            <textarea value={primaryComplaint} onChange={(e) => setPrimaryComplaint(e.target.value)} className="mt-1 min-h-[64px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px]" />
          </label>
          <label className="text-[12px] font-semibold text-ink-600 sm:col-span-2">
            Booking notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 min-h-[64px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px]" />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            disabled={pending || !slot || !patientName.trim() || !phoneNumber.trim()}
            onClick={createBooking}
            className="rounded-control bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? "Saving..." : "Confirm booking"}
          </button>
        </div>
      </section>
    </div>
  );
}
