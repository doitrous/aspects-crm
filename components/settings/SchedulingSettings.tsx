"use client";

import { useActionState } from "react";
import {
  createBlockedTimeAction,
  deleteBlockedTimeAction,
  type SchedulingActionState,
  updateScheduleTemplateAction,
} from "@/app/(crm)/settings/scheduling-actions";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { BookingSchedulingSnapshot, BookingSchedule } from "@/lib/booking/service";

const IDLE: SchedulingActionState = { ok: false };
const DAY: Record<number, string> = {
  6: "Saturday",
  0: "Sunday",
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
};
const DAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

function fieldClass(extra = "") {
  return `rounded-control border border-line-soft bg-white px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary ${extra}`;
}

function ErrorLine({ state }: { state: SchedulingActionState }) {
  if (!state.error) return null;
  return <div className="mt-2 text-[11px] font-semibold text-red-600">{state.error}</div>;
}

function ScheduleForm({
  schedule,
  doctorName,
  branchName,
}: {
  schedule: BookingSchedule;
  doctorName: string;
  branchName: string;
}) {
  const [state, action, pending] = useActionState(updateScheduleTemplateAction, IDLE);
  return (
    <form action={action} className="grid gap-2 border-b border-line-faint py-3 last:border-b-0 md:grid-cols-[1.2fr_0.9fr_0.7fr_0.7fr_0.8fr_auto] md:items-end">
      <input type="hidden" name="scheduleId" value={schedule.id} />
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Doctor / branch
        <span className="text-[12.5px] font-bold text-ink-900">{doctorName}</span>
        <span className="text-[11px] font-medium text-ink-500">{branchName} - {DAY[schedule.dayOfWeek] ?? schedule.dayOfWeek}</span>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Active
        <span className="flex h-8 items-center gap-2">
          <input type="checkbox" name="active" defaultChecked={schedule.active} />
          <span className="text-[12px] text-ink-700">Available to booking</span>
        </span>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Start
        <input className={fieldClass()} type="time" name="startTime" defaultValue={schedule.startTime.slice(0, 5)} required />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        End
        <input className={fieldClass()} type="time" name="endTime" defaultValue={schedule.endTime.slice(0, 5)} required />
      </label>
      <div className="grid grid-cols-[1fr_86px] gap-2">
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
          First come
          <span className="flex h-8 items-center gap-2">
            <input type="checkbox" name="firstComeFirstServe" defaultChecked={schedule.firstComeFirstServe} />
            <span className="text-[12px] text-ink-700">Queue</span>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
          Cap.
          <input className={fieldClass()} type="number" name="firstComeCapacity" min={1} defaultValue={schedule.firstComeCapacity} />
        </label>
      </div>
      <button
        className="h-8 rounded-control bg-primary px-3 text-[12px] font-bold text-white disabled:opacity-50"
        type="submit"
        disabled={pending}
      >
        {pending ? "Saving" : "Save"}
      </button>
      <div className="md:col-span-6">
        <ErrorLine state={state} />
        {state.ok && <div className="mt-2 text-[11px] font-semibold text-emerald-600">Saved to live booking schedule.</div>}
      </div>
    </form>
  );
}

function BlockForm({ snapshot }: { snapshot: BookingSchedulingSnapshot }) {
  const [state, action, pending] = useActionState(createBlockedTimeAction, IDLE);
  return (
    <form action={action} className="grid gap-2 md:grid-cols-[130px_110px_110px_1fr_1fr_1.4fr_auto] md:items-end">
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Date
        <input className={fieldClass()} type="date" name="date" required />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Start
        <input className={fieldClass()} type="time" name="startTime" />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        End
        <input className={fieldClass()} type="time" name="endTime" />
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Doctor
        <select className={fieldClass()} name="doctorId" defaultValue="">
          <option value="">Any doctor</option>
          {snapshot.doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>{doctor.nameEn}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Branch
        <select className={fieldClass()} name="branchId" defaultValue="">
          <option value="">Any branch</option>
          {snapshot.branches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.nameEn}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
        Reason
        <input className={fieldClass()} name="reason" placeholder="Holiday, leave, maintenance" required />
      </label>
      <div className="flex flex-col gap-2">
        <label className="flex h-8 items-center gap-2 text-[11px] font-semibold text-ink-600">
          <input type="checkbox" name="fullDay" /> Full day
        </label>
        <button className="h-8 rounded-control bg-primary px-3 text-[12px] font-bold text-white hover:bg-primary-hover disabled:opacity-50" disabled={pending}>
          {pending ? "Adding" : "Add block"}
        </button>
      </div>
      <div className="md:col-span-7">
        <ErrorLine state={state} />
        {state.ok && <div className="mt-2 text-[11px] font-semibold text-emerald-600">Blocked time saved to live booking availability.</div>}
      </div>
    </form>
  );
}

function DeleteBlockForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteBlockedTimeAction, IDLE);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="rounded-control border border-line-soft px-2 py-1 text-[11px] font-bold text-red-600 disabled:opacity-50" disabled={pending}>
        {pending ? "Removing" : "Remove"}
      </button>
      <ErrorLine state={state} />
    </form>
  );
}

export function SchedulingSettings({ snapshot }: { snapshot: BookingSchedulingSnapshot }) {
  if (!snapshot.configured) {
    return (
      <EmptyState
        title="Booking scheduling is not configured"
        hint="BOOKING_SUPABASE_URL and BOOKING_SUPABASE_SERVICE_ROLE_KEY are required on the server."
      />
    );
  }

  const doctorsById = new Map(snapshot.doctors.map((doctor) => [doctor.id, doctor]));
  const branchesById = new Map(snapshot.branches.map((branch) => [branch.id, branch]));
  const doctorsWithSchedules = snapshot.doctors.map((doctor) => ({
    ...doctor,
    schedules: [...doctor.schedules].sort((a, b) => DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek) || a.startTime.localeCompare(b.startTime)),
  }));
  const scheduleCount = doctorsWithSchedules.reduce((count, doctor) => count + doctor.schedules.length, 0);

  return (
    <div className="space-y-4">
      <div className="section-hero rounded-xl p-5">
        <div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Live availability</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-[22px] font-black text-ink-950">Doctor schedules</h3><p className="section-hero-muted mt-1 max-w-2xl text-[12px]">Each doctor has one clear schedule card. Changes immediately control website and CRM booking availability.</p></div><div className="flex gap-2"><span className="section-hero-stat rounded-lg px-3 py-2 text-[11px] font-bold text-ink-800">{doctorsWithSchedules.length} doctors</span><span className="section-hero-stat rounded-lg px-3 py-2 text-[11px] font-bold text-ink-800">{scheduleCount} sessions</span></div></div>
      </div>
      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
          <div>
            <h3 className="text-[15px] font-black text-ink-900">Clinic-wide booking rules</h3>
            <p className="text-[11.5px] text-ink-500">
              Public booking, lead Booking, Website Reservations, Calendar, and Scheduling all read these same booking-platform rows.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-pill bg-line-faint px-2 py-0.5">Window {snapshot.settings.bookingWindowDays} days</span>
            <span className="rounded-pill bg-line-faint px-2 py-0.5">Notice {snapshot.settings.minNoticeHours}h</span>
            <span className="rounded-pill bg-line-faint px-2 py-0.5">Default {snapshot.settings.defaultDurationMinutes}m</span>
          </div>
        </div>
        {scheduleCount === 0 ? (
          <EmptyState title="No schedule templates" hint="Add schedules in the booking admin database before slots can be offered." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {doctorsWithSchedules.map((doctor) => (
              <section key={doctor.id} className="overflow-hidden rounded-xl border border-line bg-slate-50/60">
                <div className="flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-3">
                  <div><div className="text-[14px] font-black text-ink-900">{doctor.nameEn}</div><div className="mt-0.5 text-[10.5px] text-ink-400">{doctor.schedules.filter((schedule) => schedule.active).length} active weekly sessions</div></div>
                  <span className={"h-2.5 w-2.5 rounded-full " + (doctor.schedules.some((schedule) => schedule.active) ? "bg-emerald-500" : "bg-slate-300")} />
                </div>
                <div className="px-4">
                  {doctor.schedules.map((schedule) => <ScheduleForm key={schedule.id} schedule={schedule} doctorName={doctor.nameEn} branchName={branchesById.get(schedule.branchId)?.nameEn ?? "Unknown branch"} />)}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3">
          <h3 className="text-[13px] font-bold text-ink-900">Blocked dates and times</h3>
          <p className="text-[11.5px] text-ink-500">Blocks immediately remove matching slots from the public booking site and CRM booking flow.</p>
        </div>
        <BlockForm snapshot={snapshot} />
        <div className="mt-4 divide-y divide-line-faint">
          {snapshot.blockedTimes.length === 0 ? (
            <div className="py-3 text-[12px] text-ink-400">No upcoming blocked times.</div>
          ) : (
            snapshot.blockedTimes.map((block) => (
              <div key={block.id} className="grid gap-2 py-3 md:grid-cols-[130px_1fr_1fr_auto] md:items-center">
                <div className="text-[12px] font-bold text-ink-900">{block.date}</div>
                <div className="text-[12px] text-ink-700">
                  {block.fullDay ? "Full day" : `${block.startTime} - ${block.endTime}`}
                  {block.reason ? <span className="ms-2 text-ink-400">{block.reason}</span> : null}
                </div>
                <div className="text-[11.5px] text-ink-500">
                  {block.doctorId ? doctorsById.get(block.doctorId)?.nameEn ?? block.doctorName ?? "Unknown doctor" : "Any doctor"}
                  {" at "}
                  {block.branchId ? branchesById.get(block.branchId)?.nameEn ?? block.branchName ?? "Unknown branch" : "any branch"}
                </div>
                <DeleteBlockForm id={block.id} />
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
