"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  saveClosureAction,
  saveBranchAssignmentsAction,
  deleteRoomAction,
  duplicateScheduleAction,
  saveRoomAction,
  saveScheduleAction,
  saveScheduleExceptionAction,
  saveTimeOffAction,
  syncRoomsFromAdminAction,
  type SchedulingActionState,
} from "@/app/(crm)/settings/scheduling-actions";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  eightyPercentGoal,
  mergedScheduledMinutes,
  minutesBetween,
  occupancyPercent,
  serviceDurationProfile,
  sessionPatientCapacity,
} from "@/lib/scheduling/capacity";
import type { CrmScheduleRow, CrmSchedulingSnapshot } from "@/lib/scheduling/crm";
import { formatDateTime } from "@/lib/format";

const IDLE: SchedulingActionState = { ok: false };
const DAYS = [
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
] as const;
const SECTIONS = ["Availability", "Exceptions & Time Off", "Rooms", "Room Week View", "Closures", "Branch Assignments"] as const;
type Section = typeof SECTIONS[number];
const field = "crm-schedule-field";
const label = "crm-schedule-label";

function Feedback({ state }: { state: SchedulingActionState }) {
  if (state.error) return <p role="alert" className="crm-schedule-error">{state.error}</p>;
  if (state.ok) return <p role="status" className="crm-schedule-success">{state.message ?? "Saved to shared scheduling."}</p>;
  return null;
}

function ScheduleEditor({
  snapshot,
  schedule,
  doctorId,
  dayOfWeek,
  branchId: initialBranchId,
  onClose,
}: {
  snapshot: CrmSchedulingSnapshot;
  schedule?: CrmScheduleRow;
  doctorId?: string;
  dayOfWeek?: number;
  branchId: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(saveScheduleAction, IDLE);
  const [branchId, setBranchId] = useState(schedule?.branchId ?? initialBranchId);
  const [selectedDoctorId, setSelectedDoctorId] = useState(schedule?.doctorId ?? doctorId ?? "");
  const [roomId, setRoomId] = useState(schedule?.roomId ?? "");
  const [selectedDay, setSelectedDay] = useState(schedule?.dayOfWeek ?? dayOfWeek ?? 6);
  const [startTime, setStartTime] = useState(schedule?.startTime ?? "09:00");
  const [endTime, setEndTime] = useState(schedule?.endTime ?? "17:00");
  const [firstCome, setFirstCome] = useState(schedule?.firstComeFirstServe ?? false);
  const rooms = snapshot.rooms.filter((room) => room.branchId === branchId && (room.active || room.id === schedule?.roomId));
  const eligibleDoctors = snapshot.doctors.filter((doctor) => (
    snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === branchId) || doctor.id === schedule?.doctorId
  ));
  const selectedDoctor = snapshot.doctors.find((doctor) => doctor.id === selectedDoctorId);
  const durationProfile = selectedDoctor ? serviceDurationProfile(selectedDoctor, snapshot.services, schedule?.slotDurationMinutes ?? 20) : null;
  const overlappingSessions = snapshot.schedules.filter((item) => (
    item.id !== schedule?.id && item.active && item.dayOfWeek === selectedDay && item.startTime < endTime && item.endTime > startTime
  ));
  const roomConflicts = new Map(overlappingSessions.filter((item) => item.branchId === branchId && item.roomId).map((item) => [item.roomId!, item]));
  const doctorConflict = overlappingSessions.find((item) => item.doctorId === selectedDoctorId);

  useEffect(() => {
    if (state.ok) onClose();
  }, [onClose, state.ok]);

  return (
    <div className="crm-schedule-modal-backdrop" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="crm-schedule-dialog-title" className="crm-schedule-modal">
        <header className="crm-schedule-modal-header">
          <div>
            <p className="crm-schedule-eyebrow">CRM availability</p>
            <h3 id="crm-schedule-dialog-title">{schedule ? "Edit clinic session" : "Add clinic session"}</h3>
            <p>These hours and room assignments are shared by CRM and online booking.</p>
          </div>
          <button type="button" onClick={onClose} className="crm-schedule-close" aria-label="Close">×</button>
        </header>

        <form action={action} className="crm-schedule-modal-body">
          {schedule && <input type="hidden" name="id" value={schedule.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Doctor *
              <select name="doctorId" required value={selectedDoctorId} onChange={(event) => setSelectedDoctorId(event.target.value)} className={field}>
                <option value="">Choose doctor</option>
                {eligibleDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nameEn}{doctor.active ? "" : " (inactive)"}</option>)}
              </select>
            </label>
            <label className={label}>Branch *
              <select name="branchId" required value={branchId} onChange={(event) => { const nextBranchId = event.target.value; setBranchId(nextBranchId); setRoomId(""); if (!snapshot.branchAssignments.some((assignment) => assignment.doctorId === selectedDoctorId && assignment.branchId === nextBranchId)) setSelectedDoctorId(""); }} className={field}>
                <option value="">Choose branch</option>
                {snapshot.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Day *
              <select name="dayOfWeek" value={selectedDay} onChange={(event) => setSelectedDay(Number(event.target.value))} className={field}>
                {DAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
              </select>
            </label>
            <label className={label}>Room *
              <select name="roomId" required value={roomId} onChange={(event) => setRoomId(event.target.value)} className={field}>
                <option value="">Choose a room</option>
                {rooms.map((room) => { const conflict = roomConflicts.get(room.id); return <option key={room.id} value={room.id} disabled={Boolean(conflict)}>{room.nameEn}{room.active ? "" : " (inactive)"}{conflict ? ` — busy ${conflict.startTime}–${conflict.endTime} (${conflict.doctorName})` : ""}</option>; })}
              </select>
            </label>
          </div>
          {rooms.length === 0 && <div className="crm-schedule-notice">Create an active room for this branch before adding clinic hours.</div>}
          {roomConflicts.size > 0 && <div className="crm-schedule-room-status"><strong>Room availability for {DAYS.find((day) => day.value === selectedDay)?.label}</strong>{Array.from(roomConflicts.values()).map((conflict) => <span key={conflict.id}>{conflict.roomName}: {conflict.startTime}–{conflict.endTime} · {conflict.doctorName}</span>)}</div>}
          {doctorConflict && <div className="crm-schedule-error">{doctorConflict.doctorName} is already scheduled {doctorConflict.startTime}–{doctorConflict.endTime} at {doctorConflict.branchName}.</div>}

          <div className="grid grid-cols-2 gap-4">
            <label className={label}>Start time *<input type="time" name="startTime" required value={startTime} onChange={(event) => setStartTime(event.target.value)} className={field}/></label>
            <label className={label}>End time *<input type="time" name="endTime" required value={endTime} onChange={(event) => setEndTime(event.target.value)} className={field}/></label>
          </div>

          {durationProfile && <div className="crm-schedule-service-profile"><strong>Service-aware capacity</strong><span>{durationProfile.serviceCount || "No"} eligible services · {durationProfile.shortestMinutes}–{durationProfile.longestMinutes} min · {durationProfile.averageMinutes} min planning average</span></div>}

          <div className="crm-schedule-dialog-section">
            <label className="crm-toggle-row">
              <input type="checkbox" name="firstComeFirstServe" checked={firstCome} onChange={(event) => setFirstCome(event.target.checked)} className="crm-toggle-input"/>
              <span className="crm-toggle-track" aria-hidden="true"><span/></span>
              <span><strong>First-come clinic</strong><small>Patients reserve a place in the session instead of an exact time.</small></span>
            </label>
            {firstCome && <label className={`${label} mt-3 max-w-[180px]`}>Maximum patients<input type="number" min={1} max={500} name="firstComeCapacity" defaultValue={schedule?.firstComeCapacity ?? 10} className={field}/></label>}
            {!firstCome && (
              <input type="hidden" name="firstComeCapacity" value={schedule?.firstComeCapacity ?? 10}/>
            )}
          </div>

          <label className="crm-toggle-row">
            <input type="checkbox" name="active" defaultChecked={schedule?.active ?? true} className="crm-toggle-input"/>
            <span className="crm-toggle-track" aria-hidden="true"><span/></span>
            <span><strong>Available for CRM booking</strong><small>Inactive sessions remain visible for historical reference.</small></span>
          </label>

          <label className="crm-toggle-row">
            <input type="checkbox" name="showOnBookingWebsite" defaultChecked={schedule?.showOnBookingWebsite ?? true} className="crm-toggle-input"/>
            <span className="crm-toggle-track" aria-hidden="true"><span/></span>
            <span><strong>Show on Booking Website</strong><small>Controls only public schedule visibility. The doctor profile is not changed.</small></span>
          </label>

          <Feedback state={state}/>
          <footer className="crm-schedule-modal-footer">
            <button type="button" onClick={onClose} className="crm-schedule-button secondary">Cancel</button>
            <button disabled={pending || rooms.length === 0 || !roomId || Boolean(roomConflicts.get(roomId)) || Boolean(doctorConflict)} className="crm-schedule-button primary">{pending ? "Saving…" : "Save clinic session"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function DuplicateScheduleEditor({ snapshot, schedule, onClose }: { snapshot: CrmSchedulingSnapshot; schedule: CrmScheduleRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(duplicateScheduleAction, IDLE);
  const eligibleDoctors = snapshot.doctors.filter((doctor) => snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === schedule.branchId));
  useEffect(() => { if (state.ok) onClose(); }, [onClose, state.ok]);
  return (
    <div className="crm-schedule-modal-backdrop" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="crm-duplicate-dialog-title" className="crm-schedule-modal max-w-2xl">
        <header className="crm-schedule-modal-header"><div><p className="crm-schedule-eyebrow">Duplicate shared schedule</p><h3 id="crm-duplicate-dialog-title">Copy {schedule.startTime}–{schedule.endTime}</h3><p>Choose target doctors and days. The original room is reused when free; otherwise the next available room at {schedule.branchName} is assigned.</p></div><button type="button" onClick={onClose} className="crm-schedule-close" aria-label="Close">×</button></header>
        <form action={action} className="crm-schedule-modal-body">
          <input type="hidden" name="scheduleId" value={schedule.id}/>
          <fieldset><legend className={`${label} mb-2`}>Target doctors *</legend><div className="grid gap-2 sm:grid-cols-2">{eligibleDoctors.map((doctor) => <label key={doctor.id} className="crm-branch-assignment-option"><input type="checkbox" name="doctorIds" value={doctor.id} defaultChecked={doctor.id === schedule.doctorId}/><span className="crm-branch-assignment-check" aria-hidden="true">✓</span><span><strong>{doctor.nameEn}</strong></span></label>)}</div></fieldset>
          <fieldset><legend className={`${label} mb-2`}>Target days *</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{DAYS.map((day) => <label key={day.value} className="crm-branch-assignment-option"><input type="checkbox" name="daysOfWeek" value={day.value}/><span className="crm-branch-assignment-check" aria-hidden="true">✓</span><span><strong>{day.label}</strong></span></label>)}</div></fieldset>
          <div className="crm-schedule-notice">The copy keeps its times, first-come capacity, active state, and “Show on Booking Website” setting. Doctor and room conflicts are skipped safely.</div>
          <Feedback state={state}/>
          <footer className="crm-schedule-modal-footer"><button type="button" onClick={onClose} className="crm-schedule-button secondary">Cancel</button><button disabled={pending} className="crm-schedule-button primary">{pending ? "Duplicating…" : "Duplicate schedule"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function Availability({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  const initialBranch = snapshot.branches.find((branch) => branch.active)?.id ?? "";
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranch);
  const [editor, setEditor] = useState<{ schedule?: CrmScheduleRow; doctorId?: string; dayOfWeek?: number } | null>(null);
  const [duplicate, setDuplicate] = useState<CrmScheduleRow | null>(null);
  const selectedBranch = snapshot.branches.find((branch) => branch.id === selectedBranchId);
  const branchSchedules = useMemo(() => snapshot.schedules.filter((schedule) => schedule.branchId === selectedBranchId), [selectedBranchId, snapshot.schedules]);
  const assignedDoctorIds = new Set(snapshot.branchAssignments.filter((assignment) => assignment.branchId === selectedBranchId).map((assignment) => assignment.doctorId));
  const visibleDoctors = snapshot.doctors.filter((doctor) => assignedDoctorIds.has(doctor.id) || branchSchedules.some((schedule) => schedule.doctorId === doctor.id));

  return (
    <div className="space-y-5">
      <section className="crm-schedule-branch-picker">
        <div>
          <div className="crm-schedule-picker-title"><span aria-hidden="true">⌂</span> Scheduling location</div>
          <p>Each branch has its own weekly calendar. Rehab never inherits another clinic&apos;s hours.</p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Scheduling branch">
          {snapshot.branches.filter((branch) => branch.active).map((branch) => (
            <button key={branch.id} type="button" aria-pressed={branch.id === selectedBranchId} onClick={() => setSelectedBranchId(branch.id)} className={`crm-schedule-branch-tab ${branch.id === selectedBranchId ? "is-active" : ""}`}>
              {branch.nameEn}
            </button>
          ))}
        </div>
      </section>

      {visibleDoctors.map((doctor) => {
        const doctorSchedules = branchSchedules.filter((schedule) => schedule.doctorId === doctor.id);
        const activeDays = new Set(doctorSchedules.filter((schedule) => schedule.active).map((schedule) => schedule.dayOfWeek)).size;
        const initials = doctor.nameEn.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
        const durationProfile = serviceDurationProfile(doctor, snapshot.services);
        const dailyCapacity = new Map(DAYS.map((day) => [day.value, doctorSchedules.filter((schedule) => schedule.dayOfWeek === day.value).reduce((sum, schedule) => sum + sessionPatientCapacity(schedule, durationProfile), 0)]));
        const weeklyCapacity = Array.from(dailyCapacity.values()).reduce((sum, capacity) => sum + capacity, 0);
        const weeklyGoal = eightyPercentGoal(weeklyCapacity);
        const busiestDayCapacity = Math.max(0, ...dailyCapacity.values());
        return (
          <section key={doctor.id} className="crm-doctor-calendar">
            <header>
              <div className="flex min-w-0 items-center gap-3">
                <div className="crm-doctor-avatar">{initials || "DR"}</div>
                <div className="min-w-0">
                  <h3>{doctor.nameEn}</h3>
                  <p>{activeDays} scheduled day{activeDays === 1 ? "" : "s"} at {selectedBranch?.nameEn ?? "this branch"}{assignedDoctorIds.has(doctor.id) ? "" : " · Branch assignment removed"}</p>
                </div>
              </div>
              <div className="crm-doctor-capacity">
                <span><small>Weekly maximum</small><strong>{weeklyCapacity} patients</strong></span>
                <span><small>80% occupation goal</small><strong>{weeklyGoal} patients</strong></span>
                <span><small>Busiest-day maximum</small><strong>{busiestDayCapacity} patients</strong></span>
                <span><small>Service planning</small><strong>{durationProfile.averageMinutes} min avg.</strong></span>
              </div>
              <button type="button" disabled={!assignedDoctorIds.has(doctor.id)} onClick={() => setEditor({ doctorId: doctor.id })} className="crm-schedule-button secondary"><span aria-hidden="true">＋</span> Add clinic session</button>
            </header>

            <div className="overflow-x-auto">
              <div className="crm-week-grid">
                {DAYS.map((day) => {
                  const rows = doctorSchedules.filter((schedule) => schedule.dayOfWeek === day.value).sort((a, b) => a.startTime.localeCompare(b.startTime));
                  const activeRows = rows.filter((schedule) => schedule.active);
                  const inactiveRows = rows.filter((schedule) => !schedule.active);
                  const dayOff = activeRows.length === 0;
                  return (
                    <div key={day.value} className={`crm-day-card ${dayOff ? "is-off" : ""}`}>
                      <div className="crm-day-heading"><span><strong>{day.short}</strong><small>{day.label}</small></span><i aria-hidden="true"/></div>
                      <div className="space-y-2">
                        {activeRows.map((schedule) => (
                          <article key={schedule.id} className="crm-session-card">
                            <div className="flex items-start justify-between gap-1">
                              <div>
                                <strong><span aria-hidden="true">◷</span>{schedule.startTime}–{schedule.endTime}</strong>
                                <small>{schedule.roomName ?? "Room required"} · {durationProfile.averageMinutes} min service average</small>
                                {schedule.firstComeFirstServe && <small>First come · {schedule.firstComeCapacity}</small>}
                                <small>{schedule.showOnBookingWebsite ? "Visible on booking website" : "CRM only · hidden from website"}</small>
                              </div>
                              <span className="flex"><button type="button" aria-label={`Duplicate ${day.label} hours for ${doctor.nameEn}`} title="Duplicate schedule" onClick={() => setDuplicate(schedule)}>⧉</button><button type="button" aria-label={`Edit ${day.label} hours for ${doctor.nameEn}`} onClick={() => setEditor({ schedule })}>✎</button></span>
                            </div>
                          </article>
                        ))}
                        {dayOff && <div className="crm-day-off"><span aria-hidden="true">⊘</span><span>Day off</span>{inactiveRows.length > 0 && <small>{inactiveRows.length} inactive session{inactiveRows.length === 1 ? "" : "s"}</small>}</div>}
                      </div>
                      {!dayOff && <div className="crm-day-capacity"><strong>Max {dailyCapacity.get(day.value) ?? 0}</strong><span>80% goal {eightyPercentGoal(dailyCapacity.get(day.value) ?? 0)}</span></div>}
                      <div className="mt-3 space-y-1.5">
                        {inactiveRows.map((schedule) => <button key={schedule.id} type="button" onClick={() => setEditor({ schedule })} className="crm-day-action">Restore {schedule.startTime}</button>)}
                        <button type="button" disabled={!assignedDoctorIds.has(doctor.id)} onClick={() => setEditor({ doctorId: doctor.id, dayOfWeek: day.value })} className="crm-day-action is-add">＋ Add {dayOff ? "hours" : "session"}</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        );
      })}

      {visibleDoctors.length === 0 && <EmptyState title="No doctors available" hint="Add an active doctor before creating CRM availability."/>}
      {editor && (
        <ScheduleEditor key={editor.schedule?.id ?? `${editor.doctorId}-${editor.dayOfWeek ?? "new"}`} snapshot={snapshot} schedule={editor.schedule} doctorId={editor.doctorId} dayOfWeek={editor.dayOfWeek} branchId={selectedBranchId} onClose={() => setEditor(null)}/>
      )}
      {duplicate && <DuplicateScheduleEditor key={duplicate.id} snapshot={snapshot} schedule={duplicate} onClose={() => setDuplicate(null)}/>}
    </div>
  );
}

function compactDuration(minutes: number) {
  if (minutes <= 0) return "0h";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours ? `${hours}h` : ""}${remainder ? ` ${remainder}m` : ""}`.trim();
}

function RoomWeekView({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  const initialBranch = snapshot.branches.find((branch) => branch.active)?.id ?? "";
  const [branchId, setBranchId] = useState(initialBranch);
  const branch = snapshot.branches.find((item) => item.id === branchId);
  const rooms = snapshot.rooms.filter((room) => room.branchId === branchId);
  const activeSchedules = snapshot.schedules.filter((schedule) => schedule.branchId === branchId && schedule.active && schedule.roomId);
  const doctorProfiles = new Map(snapshot.doctors.map((doctor) => [doctor.id, serviceDurationProfile(doctor, snapshot.services)]));
  const openMinutesPerDay = minutesBetween(snapshot.workingHours.startTime, snapshot.workingHours.endTime);
  const openDays = new Set(snapshot.workingHours.days);
  const availableWeekMinutes = openMinutesPerDay * openDays.size;
  const roomStats = rooms.map((room) => {
    const sessions = activeSchedules.filter((schedule) => schedule.roomId === room.id);
    const days = DAYS.map((day) => {
      const daySessions = sessions.filter((schedule) => schedule.dayOfWeek === day.value).sort((a, b) => a.startTime.localeCompare(b.startTime));
      const scheduledMinutes = mergedScheduledMinutes(daySessions);
      const maximumPatients = daySessions.reduce((sum, session) => {
        const profile = doctorProfiles.get(session.doctorId) ?? serviceDurationProfile({ id: session.doctorId }, snapshot.services, session.slotDurationMinutes);
        return sum + sessionPatientCapacity(session, profile);
      }, 0);
      const isOpen = openDays.has(day.value);
      return { ...day, sessions: daySessions, scheduledMinutes, maximumPatients, isOpen, freeMinutes: isOpen ? Math.max(0, openMinutesPerDay - scheduledMinutes) : 0 };
    });
    const scheduledMinutes = days.reduce((sum, day) => sum + day.scheduledMinutes, 0);
    const maximumPatients = days.reduce((sum, day) => sum + day.maximumPatients, 0);
    return { room, days, scheduledMinutes, maximumPatients, occupancy: occupancyPercent(scheduledMinutes, availableWeekMinutes) };
  });
  const activeRoomStats = roomStats.filter((item) => item.room.active);
  const averageOccupancy = activeRoomStats.length ? Math.round(activeRoomStats.reduce((sum, item) => sum + item.occupancy, 0) / activeRoomStats.length) : 0;
  const weeklyPatientCapacity = activeRoomStats.reduce((sum, item) => sum + item.maximumPatients, 0);
  const busiestRoom = [...activeRoomStats].sort((a, b) => b.occupancy - a.occupancy)[0];

  return (
    <div className="space-y-4">
      <section className="crm-schedule-branch-picker">
        <div><div className="crm-schedule-picker-title"><span aria-hidden="true">▦</span> Room week planning</div><p>Scheduled occupancy and free room time using {snapshot.workingHours.label}.</p></div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Room planning branch">
          {snapshot.branches.filter((item) => item.active).map((item) => <button key={item.id} type="button" aria-pressed={item.id === branchId} onClick={() => setBranchId(item.id)} className={`crm-schedule-branch-tab ${item.id === branchId ? "is-active" : ""}`}>{item.nameEn}</button>)}
        </div>
      </section>

      <section className="crm-room-metrics" aria-label={`Room capacity metrics for ${branch?.nameEn ?? "selected branch"}`}>
        <article><span>Average scheduled occupancy</span><strong>{averageOccupancy}%</strong><small>Across active rooms</small></article>
        <article><span>Maximum patient capacity / week</span><strong>{weeklyPatientCapacity}</strong><small>Service-duration adjusted</small></article>
        <article><span>Highest room occupation</span><strong>{busiestRoom?.occupancy ?? 0}%</strong><small>{busiestRoom?.room.nameEn ?? "No scheduled room"}</small></article>
        <article><span>Active clinic rooms</span><strong>{activeRoomStats.length}</strong><small>{compactDuration(availableWeekMinutes)} available each</small></article>
      </section>

      <div className="crm-room-week-legend"><span><i className="is-busy"/>Scheduled</span><span><i className="is-free"/>Available</span><small>Capacity uses each doctor&apos;s eligible service-duration average and never exceeds a first-come session limit.</small></div>

      {roomStats.map(({ room, days, occupancy, maximumPatients }) => (
        <section key={room.id} className={`crm-room-week ${room.active ? "" : "is-inactive"}`}>
          <header>
            <div><div className="flex items-center gap-2"><h3>{room.nameEn}</h3>{!room.active && <span className="crm-room-inactive-badge">Inactive</span>}</div><p>{branch?.nameEn} · {(room.roomType ?? "clinic").replaceAll("_", " ")}</p></div>
            <div className="crm-room-week-summary"><span><small>Scheduled occupation</small><strong>{occupancy}%</strong></span><span><small>Maximum patients</small><strong>{maximumPatients} / week</strong></span></div>
          </header>
          <div className="crm-room-occupancy-track" aria-label={`${room.nameEn} ${occupancy}% occupied`}><span style={{ width: `${occupancy}%` }}/></div>
          <div className="overflow-x-auto">
            <div className="crm-room-week-grid">
              {days.map((day) => (
                <article key={day.value} className={day.isOpen ? "" : "is-closed"}>
                  <div className="crm-room-day-heading"><strong>{day.short}</strong><span>{day.isOpen ? `${compactDuration(day.freeMinutes)} free` : "Closed"}</span></div>
                  <div className="space-y-1.5">
                    {day.sessions.map((session) => <div key={session.id} className="crm-room-session"><strong>{session.startTime}–{session.endTime}</strong><span>{session.doctorName}</span></div>)}
                    {day.isOpen && day.sessions.length === 0 && <div className="crm-room-free-day">Available all day</div>}
                    {!day.isOpen && <div className="crm-room-closed-day">Clinic closed</div>}
                  </div>
                  {day.isOpen && <footer><span>{compactDuration(day.scheduledMinutes)} scheduled</span><strong>Max {day.maximumPatients} patients</strong></footer>}
                </article>
              ))}
            </div>
          </div>
        </section>
      ))}
      {rooms.length === 0 && <EmptyState title="No rooms for this branch" hint="Refresh the CRM room catalog from Admin, then assign rooms to doctor sessions."/>}
    </div>
  );
}

function RoomEditor({ snapshot, room, onClose }: { snapshot: CrmSchedulingSnapshot; room?: CrmSchedulingSnapshot["rooms"][number]; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveRoomAction, IDLE);
  useEffect(() => { if (state.ok) onClose(); }, [onClose, state.ok]);
  return <div className="crm-schedule-modal-backdrop" role="presentation"><section role="dialog" aria-modal="true" aria-labelledby="crm-room-dialog-title" className="crm-schedule-modal max-w-lg"><header className="crm-schedule-modal-header"><div><p className="crm-schedule-eyebrow">Shared clinic room</p><h3 id="crm-room-dialog-title">{room ? "Edit room" : "Add room"}</h3><p>Changes are immediately shared with Admin scheduling, CRM, and online availability.</p></div><button type="button" onClick={onClose} className="crm-schedule-close" aria-label="Close">×</button></header><form action={action} className="crm-schedule-modal-body">{room && <input type="hidden" name="id" value={room.id}/>}<label className={label}>Branch *<select required name="branchId" defaultValue={room?.branchId ?? ""} className={field}><option value="">Choose branch</option>{snapshot.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label><div className="grid gap-4 sm:grid-cols-2"><label className={label}>English name *<input required name="nameEn" defaultValue={room?.nameEn ?? ""} className={field}/></label><label className={label}>Arabic name<input name="nameAr" dir="rtl" defaultValue={room?.nameAr ?? ""} className={field}/></label></div><label className={label}>Room type<select name="roomType" defaultValue={room?.roomType ?? "clinic"} className={field}><option value="clinic">Clinic</option><option value="procedure">Procedure</option><option value="laser">Laser</option><option value="surgery">Surgery</option><option value="recovery">Recovery</option><option value="reception">Reception</option><option value="other">Other</option></select></label><label className="crm-toggle-row"><input type="checkbox" name="active" defaultChecked={room?.active ?? true} className="crm-toggle-input"/><span className="crm-toggle-track" aria-hidden="true"><span/></span><span><strong>Active room</strong><small>Inactive rooms remain visible but cannot receive new schedules.</small></span></label><Feedback state={state}/><footer className="crm-schedule-modal-footer"><button type="button" onClick={onClose} className="crm-schedule-button secondary">Cancel</button><button disabled={pending} className="crm-schedule-button primary">{pending ? "Saving…" : "Save room"}</button></footer></form></section></div>;
}

function DeleteRoomForm({ roomId, roomName }: { roomId: string; roomName: string }) {
  const [state, action, pending] = useActionState(deleteRoomAction, IDLE);
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Delete ${roomName}? This is allowed only when it has no CRM schedule history.`)) event.preventDefault(); }}><input type="hidden" name="id" value={roomId}/><button disabled={pending} className="crm-room-icon-button danger" aria-label={`Delete ${roomName}`} title={state.error ?? `Delete ${roomName}`}>{pending ? "…" : "⌫"}</button>{state.error && <span className="fixed bottom-4 end-4 z-[120] max-w-sm rounded-lg bg-danger-bg p-3 text-[11px] font-bold text-danger shadow-xl" role="alert">{state.error}</span>}</form>;
}

function RoomSyncFeedback({ state }: { state: SchedulingActionState }) {
  if (state.error) return <Feedback state={state}/>;
  if (!state.ok || !state.roomSync) return null;
  const groups = [
    { label: "Added", items: state.roomSync.added, className: "is-added" },
    { label: "Updated", items: state.roomSync.updated, className: "is-updated" },
    { label: "Deleted", items: state.roomSync.deleted, className: "is-deleted" },
    { label: "Shared rooms", items: state.roomSync.retained, className: "is-retained" },
  ];
  return (
    <div className="crm-room-sync-result" role="status">
      <strong>{state.message}</strong>
      <div className="crm-room-sync-groups">
        {groups.map((group) => (
          <section key={group.label} className={group.className}>
            <b>{group.label} ({group.items.length})</b>
            {group.items.length > 0
              ? <ul>{group.items.map((room) => <li key={room.id}>{room.name} <span>· {room.branchName}</span></li>)}</ul>
              : <p>None</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

function Rooms({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  const [editor, setEditor] = useState<CrmSchedulingSnapshot["rooms"][number] | "new" | null>(null);
  const [syncState, syncAction, syncing] = useActionState(syncRoomsFromAdminAction, IDLE);
  const grouped = snapshot.branches.map((branch) => ({ branch, rooms: snapshot.rooms.filter((room) => room.branchId === branch.id) })).filter((group) => group.rooms.length > 0);
  return (
    <div className="space-y-5">
      <section className="crm-schedule-panel">
        <div className="crm-schedule-panel-heading"><div><h3>Clinic rooms</h3><p>Canonical rooms shared by CRM, Admin scheduling, and online availability.</p></div><div className="flex flex-wrap gap-2"><form action={syncAction}><button disabled={syncing} className="crm-schedule-button secondary">{syncing ? "Refreshing…" : "↻ Refresh shared rooms"}</button></form><button type="button" onClick={() => setEditor("new")} className="crm-schedule-button primary">＋ Add room</button></div></div>
        {syncState.error || syncState.ok ? <div className="p-4"><RoomSyncFeedback state={syncState}/></div> : null}
      </section>
      {grouped.map(({ branch, rooms }) => <section key={branch.id} className="space-y-2"><div className="flex items-center justify-between px-1"><h4 className="text-[12px] font-black text-ink-700">{branch.nameEn}</h4><span className="text-[10px] text-ink-400">{rooms.length} room{rooms.length === 1 ? "" : "s"}</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rooms.map((room) => <Card key={room.id} className={`p-4 ${room.active ? "" : "opacity-65"}`}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><b className="text-[13px] text-ink-900">{room.nameEn}</b><span className={`rounded-pill px-2 py-0.5 text-[9px] font-bold ${room.active ? "bg-emerald-50 text-emerald-700" : "bg-line-faint text-ink-400"}`}>{room.active ? "Active" : "Inactive"}</span></div>{room.nameAr && <p dir="rtl" className="mt-1 text-[11px] text-ink-500">{room.nameAr}</p>}<p className="mt-2 text-[10px] capitalize text-ink-400">{(room.roomType ?? "clinic").replaceAll("_", " ")}</p></div><div className="flex gap-1"><button type="button" onClick={() => setEditor(room)} className="crm-room-icon-button" aria-label={`Edit ${room.nameEn}`}>✎</button><DeleteRoomForm roomId={room.id} roomName={room.nameEn}/></div></div></Card>)}</div></section>)}
      {snapshot.rooms.length === 0 && <EmptyState title="No clinic rooms yet" hint="Add the first shared room for a branch."/>}
      {editor && (
        <RoomEditor key={editor === "new" ? "new" : editor.id} snapshot={snapshot} room={editor === "new" ? undefined : editor} onClose={() => setEditor(null)}/>
      )}
    </div>
  );
}

function ExceptionsAndTimeOff({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  const [mode, setMode] = useState<"exception" | "timeOff">("exception");
  const [exceptionState, exceptionAction, exceptionPending] = useActionState(saveScheduleExceptionAction, IDLE);
  const [timeOffState, timeOffAction, timeOffPending] = useActionState(saveTimeOffAction, IDLE);
  const [branchId, setBranchId] = useState("");
  const [timeOffBranchId, setTimeOffBranchId] = useState("");
  const rooms = snapshot.rooms.filter((room) => room.branchId === branchId && room.active);
  const exceptionDoctors = snapshot.doctors.filter((doctor) => snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === branchId));
  const timeOffDoctors = timeOffBranchId
    ? snapshot.doctors.filter((doctor) => snapshot.branchAssignments.some((assignment) => assignment.doctorId === doctor.id && assignment.branchId === timeOffBranchId))
    : snapshot.doctors;
  const timeline = [
    ...snapshot.exceptions.map((entry) => ({
      id: `exception-${entry.id}`,
      sortValue: `${entry.exceptionDate}T${entry.startTime ?? "00:00"}`,
      kind: "Schedule exception",
      title: entry.doctorName,
      description: `${entry.exceptionType} · ${entry.branchName} · ${entry.roomName ?? "Scheduled room"}${entry.reason ? ` · ${entry.reason}` : ""}`,
      period: `${entry.exceptionDate}${entry.startTime && entry.endTime ? ` · ${entry.startTime}–${entry.endTime}` : " · Full day"}`,
      active: entry.active,
    })),
    ...snapshot.timeOff.map((entry) => ({
      id: `time-off-${entry.id}`,
      sortValue: entry.startsAt,
      kind: "Time off",
      title: entry.doctorName,
      description: `${entry.reason} · ${entry.branchName ?? "All branches"} · ${entry.status}`,
      period: `${formatDateTime(entry.startsAt)} → ${formatDateTime(entry.endsAt)}`,
      active: entry.status === "approved" || entry.status === "pending",
    })),
  ].sort((a, b) => b.sortValue.localeCompare(a.sortValue));

  return (
    <section className="crm-schedule-panel">
      <div className="crm-schedule-panel-heading">
        <div><h3>Exceptions and doctor time off</h3><p>Manage one-day schedule changes and longer leave from the same workspace.</p></div>
        <div className="crm-schedule-mode-switch" role="tablist" aria-label="Absence entry type">
          <button type="button" role="tab" aria-selected={mode === "exception"} onClick={() => setMode("exception")} className={mode === "exception" ? "is-active" : ""}>Schedule exception</button>
          <button type="button" role="tab" aria-selected={mode === "timeOff"} onClick={() => setMode("timeOff")} className={mode === "timeOff" ? "is-active" : ""}>Doctor time off</button>
        </div>
      </div>

      {mode === "exception" ? (
        <form action={exceptionAction} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className={label}>Branch<select required name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)} className={field}><option value="">Choose branch</option>{snapshot.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
          <label className={label}>Doctor<select required name="doctorId" className={field} disabled={!branchId}><option value="">Choose doctor</option>{exceptionDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nameEn}</option>)}</select></label>
          <label className={label}>Room (optional)<select name="roomId" className={field}><option value="">Use scheduled room</option>{rooms.map((room) => <option key={room.id} value={room.id}>{room.nameEn}</option>)}</select></label>
          <label className={label}>Date<input required type="date" name="exceptionDate" className={field}/></label>
          <label className={label}>Type<select name="exceptionType" className={field}><option value="unavailable">Unavailable / blocked</option></select></label>
          <label className={label}>Start (blank = full day)<input type="time" name="startTime" className={field}/></label>
          <label className={label}>End (blank = full day)<input type="time" name="endTime" className={field}/></label>
          <label className={label}>Reason<input name="reason" className={field}/></label>
          <div className="flex items-end gap-3"><label className="pb-3 text-[12px]"><input type="checkbox" name="active" defaultChecked/> Active</label><button disabled={exceptionPending} className="crm-schedule-button primary">{exceptionPending ? "Saving…" : "Add exception"}</button></div>
          <Feedback state={exceptionState}/>
        </form>
      ) : (
        <form action={timeOffAction} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
          <label className={label}>Branch<select name="branchId" value={timeOffBranchId} onChange={(event) => setTimeOffBranchId(event.target.value)} className={field}><option value="">All branches</option>{snapshot.branches.filter((branch) => branch.active).map((branch) => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
          <label className={label}>Doctor<select required name="doctorId" className={field}><option value="">Choose doctor</option>{timeOffDoctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.nameEn}</option>)}</select></label>
          <label className={label}>Starts<input required type="datetime-local" name="startsAt" className={field}/></label>
          <label className={label}>Ends<input required type="datetime-local" name="endsAt" className={field}/></label>
          <label className={label}>Reason<input required name="reason" className={field}/></label>
          <label className={label}>Notes<input name="notes" className={field}/></label>
          <label className={label}>Status<select name="status" className={field}><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></label>
          <div className="flex items-end"><button disabled={timeOffPending} className="crm-schedule-button primary">{timeOffPending ? "Saving…" : "Add time off"}</button></div>
          <Feedback state={timeOffState}/>
        </form>
      )}

      <div className="divide-y divide-line-faint border-t border-line-faint">
        {timeline.map((entry) => <div key={entry.id} className={`grid gap-1 p-4 sm:grid-cols-[1fr_auto] ${entry.active ? "" : "opacity-60"}`}><div><div className="flex items-center gap-2"><b>{entry.title}</b><span className="crm-schedule-entry-kind">{entry.kind}</span></div><p className="text-[11px] text-ink-500">{entry.description}</p></div><span className="text-[11px] text-ink-500">{entry.period}</span></div>)}
        {timeline.length === 0 && <div className="p-5 text-[12px] text-ink-400">No exceptions or time off recorded.</div>}
      </div>
    </section>
  );
}

function Closures({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  const [state, action, pending] = useActionState(saveClosureAction, IDLE);
  return (
    <section className="crm-schedule-panel">
      <div className="crm-schedule-panel-heading"><div><h3>Closures</h3><p>Block the organization, one branch, or one room for a date and time range.</p></div></div>
      <form action={action} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
        <label className={label}>Title / reason<input required name="title" className={field}/></label>
        <label className={label}>Scope<select name="scope" className={field}><option value="organization">Entire organization</option><option value="branch">Branch</option><option value="room">Room</option></select></label>
        <label className={label}>Branch<select name="branchId" className={field}><option value="">Not branch-specific</option>{snapshot.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.nameEn}</option>)}</select></label>
        <label className={label}>Room<select name="roomId" className={field}><option value="">Not room-specific</option>{snapshot.rooms.map((room) => <option key={room.id} value={room.id}>{room.nameEn}</option>)}</select></label>
        <label className={label}>Starts<input required type="datetime-local" name="startsAt" className={field}/></label>
        <label className={label}>Ends<input required type="datetime-local" name="endsAt" className={field}/></label>
        <label className={label}>Notes<input name="notes" className={field}/></label>
        <div className="flex items-end gap-3"><label className="pb-3 text-[12px]"><input type="checkbox" name="active" defaultChecked/> Active</label><button disabled={pending} className="crm-schedule-button primary">Add closure</button></div>
        <Feedback state={state}/>
      </form>
      <div className="divide-y divide-line-faint border-t border-line-faint">{snapshot.closures.map((closure) => <div key={closure.id} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto]"><div><b>{closure.title}</b><p className="text-[11px] text-ink-500">{closure.scope} · {closure.branchName ?? "All branches"} · {closure.roomName ?? "All rooms"}</p></div><span className="text-[11px] text-ink-500">{formatDateTime(closure.startsAt)} → {formatDateTime(closure.endsAt)}</span></div>)}{snapshot.closures.length === 0 && <div className="p-5 text-[12px] text-ink-400">No closures recorded.</div>}</div>
    </section>
  );
}

function DoctorBranchAssignmentCard({ snapshot, doctor }: { snapshot: CrmSchedulingSnapshot; doctor: CrmSchedulingSnapshot["doctors"][number] }) {
  const [state, action, pending] = useActionState(saveBranchAssignmentsAction, IDLE);
  const assignedIds = new Set(snapshot.branchAssignments.filter((assignment) => assignment.doctorId === doctor.id).map((assignment) => assignment.branchId));
  const initials = doctor.nameEn.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("");
  return (
    <Card className="overflow-hidden">
      <form action={action}>
        <input type="hidden" name="doctorId" value={doctor.id}/>
        <header className="flex items-center gap-3 border-b border-line-faint p-4">
          <div className="crm-doctor-avatar">{initials || "DR"}</div>
          <div><b>{doctor.nameEn}</b><p className="text-[10.5px] text-ink-400">Choose one or more clinic branches</p></div>
        </header>
        <fieldset className="space-y-2 p-4">
          <legend className="sr-only">Branches for {doctor.nameEn}</legend>
          {snapshot.branches.filter((branch) => branch.active).map((branch) => (
            <label key={branch.id} className="crm-branch-assignment-option">
              <input type="checkbox" name="branchIds" value={branch.id} defaultChecked={assignedIds.has(branch.id)}/>
              <span className="crm-branch-assignment-check" aria-hidden="true">✓</span>
              <span><strong>{branch.nameEn}</strong>{branch.nameAr && <small dir="rtl">{branch.nameAr}</small>}</span>
            </label>
          ))}
        </fieldset>
        <footer className="border-t border-line-faint p-4">
          <Feedback state={state}/>
          <button disabled={pending} className="crm-schedule-button primary mt-3 w-full">{pending ? "Saving assignments…" : "Save branch assignments"}</button>
        </footer>
      </form>
    </Card>
  );
}

function BranchAssignments({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  return (
    <div className="space-y-4">
      <section className="crm-schedule-notice">
        Branch assignments are shared with the Admin doctor catalog and public booking filters. Adding or removing a branch here changes where the doctor may work, but it does not copy, create, or delete any Admin or CRM schedule hours.
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.doctors.map((doctor) => <DoctorBranchAssignmentCard key={doctor.id} snapshot={snapshot} doctor={doctor}/>) }
      </div>
    </div>
  );
}

export function SchedulingSettings({ snapshot }: { snapshot: CrmSchedulingSnapshot }) {
  const [section, setSection] = useState<Section>("Availability");
  if (!snapshot.catalogConfigured) return <EmptyState title="Shared scheduling is not configured" hint="The CRM needs the booking Supabase server credentials to manage canonical schedules."/>;
  if (!snapshot.migrationReady) return <EmptyState title="Shared scheduling migration required" hint="Apply 018_crm_scheduling_source_of_truth.sql in the booking database before managing schedules."/>;

  return (
    <div className="space-y-5">
      <header className="crm-schedule-hero">
        <div><p className="crm-schedule-eyebrow">Single source of truth</p><h2>Doctors and Scheduling</h2><p>Manage the shared weekly calendar used by CRM and online booking, including rooms, exceptions, closures, time off, and website visibility.</p></div>
        <div className="crm-schedule-hero-stats"><span><strong>{snapshot.doctors.filter((doctor) => doctor.active).length}</strong>Doctors</span><span><strong>{snapshot.schedules.filter((schedule) => schedule.active).length}</strong>Active sessions</span><span><strong>{snapshot.rooms.filter((room) => room.active).length}</strong>Rooms</span></div>
      </header>

      <nav role="tablist" aria-label="Doctors and scheduling sections" className="crm-schedule-tabs">
        {SECTIONS.map((name) => <button key={name} type="button" role="tab" aria-selected={section === name} onClick={() => setSection(name)} className={section === name ? "is-active" : ""}>{name}</button>)}
      </nav>

      {section === "Availability" && <Availability snapshot={snapshot}/>}
      {section === "Exceptions & Time Off" && <ExceptionsAndTimeOff snapshot={snapshot}/>}
      {section === "Rooms" && <Rooms snapshot={snapshot}/>}
      {section === "Room Week View" && <RoomWeekView snapshot={snapshot}/>}
      {section === "Closures" && <Closures snapshot={snapshot}/>}
      {section === "Branch Assignments" && <BranchAssignments snapshot={snapshot}/>}
    </div>
  );
}
