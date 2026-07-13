"use client";

import { useMemo, useState } from "react";
import {
  createLeadBookingAction,
  getBookingSlotsAction,
  updateReservationStatusAction,
} from "@/app/(crm)/booking/actions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { BOOKING_META } from "@/lib/badges";
import { formatClock, formatDate, formatDateTime } from "@/lib/format";
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
  { value: "reserved", label: "Awaiting confirmation" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "attended", label: "Attended" },
  { value: "no_show", label: "No-show" },
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

function monthStart(date: string): Date {
  const d = new Date(`${date}T00:00:00`);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fieldClass(): string {
  return "h-9 rounded-control border border-line bg-panel px-2 text-[12.5px] text-ink-700";
}

const FLOW_STEPS = ["Choose Doctor", "Date & Time", "Your Info", "Review & Confirm"] as const;

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
      {FLOW_STEPS.map((label, index) => {
        const n = index + 1;
        const active = n <= step;
        return (
          <div key={label} className="flex min-w-fit items-center gap-2">
            <span
              className={
                "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold " +
                (active ? "bg-primary text-white" : "bg-line-faint text-ink-400")
              }
            >
              {n}
            </span>
            <span className={"text-[12px] font-semibold " + (n === step ? "text-primary" : active ? "text-ink-600" : "text-ink-400")}>
              {label}
            </span>
            {index < FLOW_STEPS.length - 1 && <span className="h-px w-8 bg-line" />}
          </div>
        );
      })}
    </div>
  );
}

function DateGrid({
  selected,
  maxDate,
  onSelect,
}: {
  selected: string;
  maxDate: string;
  onSelect: (date: string) => void;
}) {
  const [cursor, setCursor] = useState(() => monthStart(selected));
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay());
  const todayValue = today();
  const days = Array.from({ length: 35 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  return (
    <div className="rounded-card border border-line bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="h-8 w-8 rounded-control border border-line text-[16px] hover:bg-line-faint">
          ‹
        </button>
        <div className="text-[13px] font-bold text-ink-900">
          {cursor.toLocaleString("en", { month: "long", year: "numeric" })}
        </div>
        <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="h-8 w-8 rounded-control border border-line text-[16px] hover:bg-line-faint">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10.5px] font-semibold text-ink-400">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((d) => {
          const value = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const disabled = value < todayValue || value > maxDate;
          const isSelected = value === selected;
          return (
            <button
              key={value}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(value)}
              className={
                "h-10 rounded-control border text-[12px] font-semibold " +
                (isSelected
                  ? "border-primary bg-primary text-white"
                  : disabled || !inMonth
                    ? "border-line-faint bg-line-faint/30 text-ink-300"
                    : "border-[#c7edf0] bg-[#f6fbfb] text-ink-700 hover:border-primary")
              }
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BookingTab({
  lead,
  bookings,
  catalog,
  onChanged,
}: {
  lead: Lead;
  bookings: Booking[];
  catalog: BookingCatalog;
  onChanged?: (bookings: Booking[]) => void;
}) {
  const [step, setStep] = useState(1);
  const [bookingRows, setBookingRows] = useState(bookings);
  const [specialtyId, setSpecialtyId] = useState(lead.specialtyId ?? catalog.specialties[0]?.id ?? "");
  const doctorsForSpecialty = useMemo(
    () => catalog.doctors.filter((d) => !specialtyId || d.specialtyId === specialtyId),
    [catalog.doctors, specialtyId],
  );
  const [doctorId, setDoctorId] = useState(
    lead.doctorId ?? (doctorsForSpecialty.length === 1 ? doctorsForSpecialty[0].id : ""),
  );
  const selectedDoctor = catalog.doctors.find((d) => d.id === doctorId);
  const [branchId, setBranchId] = useState(selectedDoctor?.schedules.find((schedule) => schedule.active)?.branchId ?? "");
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
  const status: ReservationStatus = "reserved";
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [bookingPending, setBookingPending] = useState(false);
  const [statusPending, setStatusPending] = useState<string | null>(null);
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

  const selectedSpecialty = catalog.specialties.find((s) => s.id === specialtyId);
  const selectedBranch = catalog.branches.find((b) => b.id === branchId);
  const selectedService = catalog.services.find((s) => s.id === serviceId);
  const selectedSlot = slots.find((s) => s.time === slot);
  const maxDate = addDays(catalog.settings.bookingWindowDays);
  const nearbyBookings = useMemo(() => {
    const selectedDate = new Date(`${date}T12:00:00`).getTime();
    return bookingRows.filter((booking) => {
      if (booking.status === "cancelled" || booking.status === "no_show") return false;
      const distanceDays = Math.abs(new Date(booking.startAt).getTime() - selectedDate) / 86_400_000;
      return distanceDays <= 30;
    });
  }, [bookingRows, date]);

  async function loadSlotsForDate(nextDate = date) {
    setAvailabilityLoading(true);
    try {
      setMessage({});
      setSlot("");
      setDate(nextDate);
      const result = await Promise.race([
        getBookingSlotsAction(doctorId, branchId, nextDate, serviceId || null),
        new Promise<Awaited<ReturnType<typeof getBookingSlotsAction>>>((resolve) =>
          setTimeout(() => resolve({ ok: null, error: "Availability took too long to load. Please retry." }), 20_000),
        ),
      ]);
      if (result.error) {
        setSlots([]);
        setMessage({ error: result.error });
        return;
      }
      setSlots(result.slots ?? []);
      if ((result.slots ?? []).length === 0) setMessage({ error: "No live slots are available for this selection." });
    } catch (error) {
      setSlots([]);
      setMessage({ error: error instanceof Error ? error.message : "Could not load availability." });
    } finally {
      setAvailabilityLoading(false);
    }
  }

  function proceedToDateTime() {
    if (!specialtyId || !doctorId || !branchId) {
      setMessage({ error: "Choose a specialty and doctor with an available schedule." });
      return;
    }
    setMessage({});
    setStep(2);
    void loadSlotsForDate(date);
  }

  async function createBooking() {
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
    setBookingPending(true);
    try {
      setMessage({});
      const result = await createLeadBookingAction(fd);
      if (result.error) setMessage({ error: result.error });
      else {
        setMessage({ ok: result.ok ?? "Booking created." });
        if (result.appointmentId && selectedSlot) {
          setBookingRows((current) => {
            const createdBooking: Booking = {
              id: result.appointmentId!,
              leadId: lead.id,
              doctorId,
              specialtyId,
              branch: selectedBranch?.nameEn ?? "Aspects Clinica",
              startAt: `${date}T${slot}:00`,
              durationMin: Math.max(1, Math.round((new Date(`2000-01-01T${selectedSlot.endTime}:00`).getTime() - new Date(`2000-01-01T${slot}:00`).getTime()) / 60_000)),
              status: "unconfirmed",
              source: "web",
              origin: "crm",
              calendarSynced: true,
            };
            const next = [createdBooking, ...current];
            onChanged?.(next);
            return next;
          });
        }
        setStep(4);
      }
    } catch (error) {
      setMessage({ error: error instanceof Error ? error.message : "Could not create booking." });
    } finally {
      setBookingPending(false);
    }
  }

  async function changeStatus(appointmentId: string, next: ReservationStatus) {
    setStatusPending(appointmentId);
    try {
      setMessage({});
      const result = await updateReservationStatusAction(appointmentId, next, lead.id);
      if (result.error) setMessage({ error: result.error });
      else {
        setBookingRows((current) => {
          const rows = current.map((booking) => booking.id === appointmentId
            ? { ...booking, status: next === "reserved" ? "unconfirmed" as const : next === "attended" ? "completed" as const : next === "cancelled" ? "cancelled" as const : next === "no_show" ? "no_show" as const : "confirmed" as const }
            : booking);
          onChanged?.(rows);
          return rows;
        });
        setMessage({ ok: result.ok ?? "Booking status updated." });
      }
    } catch (error) {
      setMessage({ error: error instanceof Error ? error.message : "Could not update booking status." });
    } finally {
      setStatusPending(null);
    }
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
        {bookingRows.length === 0 ? (
          <div className="rounded-card border border-line p-3 text-[12px] text-ink-400">
            No appointments are linked to this lead yet.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bookingRows.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center justify-between gap-4 rounded-card border border-primary/20 bg-primary-soft/35 p-4 shadow-sm">
                <div className="min-w-0 flex-1 basis-full sm:basis-[280px]">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={"rounded-pill px-2 py-0.5 text-[10.5px] font-bold " + (b.origin === "crm" ? "bg-slate-100 text-slate-700" : "bg-primary/10 text-primary")}>
                      {b.origin === "crm" ? "Booked by clinic" : "Website reservation"}
                    </span>
                    <span className="font-mono text-[10px] text-ink-400">{b.id}</span>
                  </div>
                  <div className="text-[14px] font-bold text-ink-900">
                    {catalog.doctors.find((doctor) => doctor.id === b.doctorId)?.nameEn ?? "Doctor not assigned"}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-control border border-line-soft bg-panel px-2.5 py-2"><div className="text-[10px] font-semibold uppercase text-ink-400">Date</div><div className="mt-0.5 text-[12px] font-bold text-ink-800">{formatDate(b.startAt)}</div></div>
                    <div className="rounded-control border border-line-soft bg-panel px-2.5 py-2"><div className="text-[10px] font-semibold uppercase text-ink-400">Time</div><div className="mt-0.5 text-[12px] font-bold text-primary">{formatClock(b.startAt)}</div></div>
                    <div className="rounded-control border border-line-soft bg-panel px-2.5 py-2"><div className="text-[10px] font-semibold uppercase text-ink-400">Duration</div><div className="mt-0.5 text-[12px] font-bold text-success">{b.durationMin} min</div></div>
                    <div className="rounded-control border border-line-soft bg-panel px-2.5 py-2"><div className="text-[10px] font-semibold uppercase text-ink-400">Branch</div><div className="mt-0.5 truncate text-[12px] font-bold text-ink-800">{b.branch}</div></div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge style={BOOKING_META[b.status]} />
                  <select
                    disabled={statusPending === b.id}
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
                    onChange={(e) => void changeStatus(b.id, e.target.value as ReservationStatus)}
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

      <section className="rounded-card border border-line bg-panel p-4">
        <Stepper step={step} />

        {step === 1 && (
          <div className="mt-4 flex flex-col gap-4">
            <div>
              <div className="text-[16px] font-bold text-ink-900">Choose Specialty or Doctor</div>
              <p className="mt-1 text-[12px] text-ink-500">Choose from the same live catalog used by the public booking form.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="rounded-card border border-[#c7edf0] bg-[#f6fbfb] p-3 text-[12px] font-semibold text-ink-700">
                Specialty
                <select
                  value={specialtyId}
                  onChange={(e) => {
                    const nextSpecialty = e.target.value;
                    setSpecialtyId(nextSpecialty);
                    const matchingDoctors = catalog.doctors.filter((d) => d.specialtyId === nextSpecialty);
                    const automaticDoctor = matchingDoctors.length === 1 ? matchingDoctors[0] : undefined;
                    setDoctorId(automaticDoctor?.id ?? "");
                    setBranchId(automaticDoctor?.schedules.find((s) => s.active)?.branchId ?? "");
                    setServiceId("");
                    setSlots([]);
                    setSlot("");
                  }}
                  className={`mt-2 w-full ${fieldClass()}`}
                >
                  <option value="">Select specialty...</option>
                  {catalog.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}
                </select>
              </label>
              <label className="rounded-card border border-[#c7edf0] bg-panel p-3 text-[12px] font-semibold text-ink-700">
                Doctor
                <select
                  value={doctorId}
                  onChange={(e) => {
                    const nextDoctor = catalog.doctors.find((d) => d.id === e.target.value);
                    setDoctorId(e.target.value);
                    if (nextDoctor) setSpecialtyId(nextDoctor.specialtyId);
                    setBranchId(nextDoctor?.schedules.find((s) => s.active)?.branchId ?? "");
                    setSlots([]);
                    setSlot("");
                  }}
                  className={`mt-2 w-full ${fieldClass()}`}
                >
                  <option value="">Select doctor...</option>
                  {doctorsForSpecialty.map((d) => <option key={d.id} value={d.id}>{d.nameEn}</option>)}
                </select>
              </label>
            </div>

            {selectedDoctor && (
              <div className="flex items-center justify-between gap-3 rounded-card bg-[#eef7ff] p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-white text-[12px] font-bold text-primary">
                    Dr
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-bold text-ink-900">{selectedDoctor.nameEn}</div>
                    <div className="truncate text-[11.5px] text-[#208a96]">{selectedDoctor.titleEn ?? selectedSpecialty?.nameEn ?? ""}</div>
                  </div>
                </div>
                <button type="button" onClick={() => setDoctorId("")} className="text-[12px] font-semibold text-primary underline">
                  Change
                </button>
              </div>
            )}

            <div>
              <label className="text-[12px] font-semibold text-ink-600">
                Service / Procedure <span className="text-ink-400">(optional)</span>
                <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setSlots([]); setSlot(""); }} className={`mt-1 w-full ${fieldClass()}`}>
                  <option value="">General Consultation</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nameEn} ({s.durationMinutes}m{s.fee ? ` · ${s.fee} EGP` : ""})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={availabilityLoading || !specialtyId || !doctorId || !branchId}
              onClick={proceedToDateTime}
              className="h-10 rounded-control bg-primary px-4 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:bg-[#9bb0bf]"
            >
              Continue to Date & Time ›
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="rounded-card bg-[#eef7ff] p-3">
              <div className="text-[13px] font-bold text-ink-900">{selectedDoctor?.nameEn ?? "Selected doctor"}</div>
              <div className="text-[11.5px] text-[#208a96]">{selectedSpecialty?.nameEn ?? ""}</div>
            </div>
            <DateGrid selected={date} maxDate={maxDate} onSelect={(next) => void loadSlotsForDate(next)} />
            <div>
              <div className="mb-2 text-[12.5px] font-bold text-ink-900">
                Available Time Slots <span className="font-normal text-ink-400">(same-day slots require advance notice)</span>
              </div>
              {availabilityLoading ? (
                <div className="rounded-card border border-line p-3 text-[12px] text-ink-400">Loading live availability...</div>
              ) : slots.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {slots.map((s) => (
                    <button
                      key={s.time}
                      type="button"
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
                          <span className="block text-[10px] opacity-80">{formatClock(s.time)} · {s.remainingCapacity} left</span>
                        </span>
                      ) : (
                        formatClock(s.time)
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="rounded-card border border-line p-3 text-[12px] text-ink-400">Choose an available date to load live slots.</div>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setStep(1)} className="h-10 rounded-control border border-line bg-panel text-[12.5px] font-semibold text-ink-700 hover:bg-line-faint">
                ‹ Back
              </button>
              <button type="button" disabled={!slot} onClick={() => setStep(3)} className="h-10 rounded-control bg-primary text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:bg-[#9bb0bf]">
                Continue ›
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="text-[16px] font-bold text-ink-900">Your Information</div>
            <label className="text-[12px] font-semibold text-ink-600">
              Full Name
              <input value={patientName} onChange={(e) => setPatientName(e.target.value)} className={`mt-1 w-full ${fieldClass()}`} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[12px] font-semibold text-ink-600">Patient Type</div>
                <div className="grid gap-2">
                  {[
                    { value: true, label: "New Patient" },
                    { value: false, label: "Follow-up" },
                  ].map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setIsNewPatient(opt.value)}
                      className={
                        "flex h-10 items-center gap-2 rounded-control border px-3 text-left text-[12.5px] font-semibold " +
                        (isNewPatient === opt.value ? "border-primary bg-primary-soft text-primary" : "border-line text-ink-700")
                      }
                    >
                      <span className={"h-3 w-3 rounded-full border " + (isNewPatient === opt.value ? "border-primary bg-primary" : "border-ink-400")} />
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="text-[12px] font-semibold text-ink-600">
                Phone Number
                <div className="mt-1 flex gap-2">
                  <input value={phoneCountryCode} onChange={(e) => setPhoneCountryCode(e.target.value)} className={`${fieldClass()} w-20`} />
                  <input value={phoneNumber} onChange={(e) => setPhoneNumber(digits(e.target.value))} className={`flex-1 ${fieldClass()}`} />
                </div>
              </label>
            </div>
            <label className="text-[12px] font-semibold text-ink-600">
              How did you hear about us?
              <input value={referralSource} onChange={(e) => setReferralSource(e.target.value)} className={`mt-1 w-full ${fieldClass()}`} />
            </label>
            <label className="text-[12px] font-semibold text-ink-600">
              Additional Notes <span className="text-ink-400">(optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 min-h-[76px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px]" />
            </label>
            <label className="text-[12px] font-semibold text-ink-600">
              Primary complaint <span className="text-ink-400">(internal)</span>
              <textarea value={primaryComplaint} onChange={(e) => setPrimaryComplaint(e.target.value)} className="mt-1 min-h-[60px] w-full rounded-control border border-line bg-panel p-2 text-[12.5px]" />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setStep(2)} className="h-10 rounded-control border border-line bg-panel text-[12.5px] font-semibold text-ink-700 hover:bg-line-faint">
                ‹ Back
              </button>
              <button type="button" disabled={!patientName.trim() || !phoneNumber.trim()} onClick={() => setStep(4)} className="h-10 rounded-control bg-primary text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:bg-[#9bb0bf]">
                Review Booking ›
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="mt-4 flex flex-col gap-4">
            <div className="text-[16px] font-bold text-ink-900">Review & Confirm</div>
            {nearbyBookings.length > 0 && !message.ok && (
              <div className="rounded-control border border-warn/40 bg-[#fffaeb] px-3 py-2.5 text-[12px] font-semibold text-warn">
                Notice: this patient already has {nearbyBookings.length} active booking{nearbyBookings.length === 1 ? "" : "s"} within 30 days of this date.
                <div className="mt-1 font-normal text-ink-600">
                  {nearbyBookings.map((booking) => formatDateTime(booking.startAt)).join(" · ")}
                </div>
              </div>
            )}
            <div className="rounded-card bg-[#eef7ff] p-4">
              <div className="mb-3 text-[13px] font-bold text-primary">Appointment Details</div>
              <div className="grid gap-2 text-[12.5px]">
                <div className="flex justify-between gap-3"><span className="text-ink-500">Doctor</span><strong>{selectedDoctor?.nameEn ?? "-"}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Specialty</span><strong>{selectedSpecialty?.nameEn ?? "-"}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Service</span><strong>{selectedService?.nameEn ?? "General Consultation"}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Date</span><strong>{formatDate(date)}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Time</span><strong>{slot ? `${formatClock(slot)} - ${formatClock(selectedSlot?.endTime ?? slot)}` : "-"}</strong></div>
              </div>
            </div>
            <div className="rounded-card bg-line-faint/50 p-4">
              <div className="mb-3 text-[13px] font-bold text-ink-900">Patient Information</div>
              <div className="grid gap-2 text-[12.5px]">
                <div className="flex justify-between gap-3"><span className="text-ink-500">Name</span><strong>{patientName || "-"}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Patient Type</span><strong>{isNewPatient ? "New Patient" : "Follow-up"}</strong></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Phone</span><strong>{phoneCountryCode} {phoneNumber}</strong></div>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setStep(3)} className="h-10 rounded-control border border-line bg-panel text-[12.5px] font-semibold text-ink-700 hover:bg-line-faint">
                ‹ Back
              </button>
              <button
                type="button"
                disabled={bookingPending || !slot || !patientName.trim() || !phoneNumber.trim()}
                onClick={() => void createBooking()}
                className="h-10 rounded-control bg-primary text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:bg-[#9bb0bf]"
              >
                {bookingPending ? "Saving..." : "Confirm Booking"}
              </button>
            </div>
            <p className="text-center text-[11.5px] text-ink-400">By confirming, the appointment is written to the live booking system and linked to this CRM lead.</p>
          </div>
        )}
      </section>
    </div>
  );
}
