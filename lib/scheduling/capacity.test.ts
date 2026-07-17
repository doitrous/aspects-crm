import assert from "node:assert/strict";
import test from "node:test";
import {
  eightyPercentGoal,
  mergedScheduledMinutes,
  occupancyPercent,
  parseWorkingHours,
  serviceDurationProfile,
  sessionPatientCapacity,
} from "./capacity";

test("working hours parse the configured Saturday-to-Thursday clinic week", () => {
  assert.deepEqual(parseWorkingHours("Saturday to Thursday, 9:00 AM to 11:00 PM"), {
    days: [6, 0, 1, 2, 3, 4], startTime: "09:00", endTime: "23:00", label: "Saturday to Thursday, 9:00 AM to 11:00 PM",
  });
});

test("doctor capacity uses the average duration of eligible services", () => {
  const profile = serviceDurationProfile({ id: "doctor", specialtyId: "specialty" }, [
    { id: "a", nameEn: "Short", durationMinutes: 20, specialtyId: "specialty", doctorId: null, assignedDoctorIds: [] },
    { id: "b", nameEn: "Long", durationMinutes: 40, specialtyId: "specialty", doctorId: null, assignedDoctorIds: [] },
  ]);
  assert.deepEqual(profile, { averageMinutes: 30, shortestMinutes: 20, longestMinutes: 40, serviceCount: 2 });
  assert.equal(sessionPatientCapacity({ id: "s", doctorId: "doctor", roomId: "room", dayOfWeek: 6, startTime: "09:00", endTime: "12:00", slotDurationMinutes: 20, firstComeFirstServe: false, firstComeCapacity: 20, active: true }, profile), 6);
  assert.equal(eightyPercentGoal(6), 5);
});

test("first-come capacity cannot exceed the service-adjusted session capacity", () => {
  const profile = { averageMinutes: 30, shortestMinutes: 20, longestMinutes: 60, serviceCount: 3 };
  assert.equal(sessionPatientCapacity({ id: "s", doctorId: "doctor", roomId: "room", dayOfWeek: 6, startTime: "09:00", endTime: "11:00", slotDurationMinutes: 20, firstComeFirstServe: true, firstComeCapacity: 10, active: true }, profile), 4);
});

test("room utilization merges overlaps and never exceeds 100 percent", () => {
  assert.equal(mergedScheduledMinutes([{ startTime: "09:00", endTime: "11:00" }, { startTime: "10:00", endTime: "12:00" }]), 180);
  assert.equal(occupancyPercent(180, 360), 50);
  assert.equal(occupancyPercent(500, 360), 100);
});
