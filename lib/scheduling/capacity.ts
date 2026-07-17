export interface CapacityService {
  id: string;
  nameEn: string;
  durationMinutes: number;
  specialtyId: string;
  doctorId: string | null;
  assignedDoctorIds: string[];
}

export interface CapacityDoctor {
  id: string;
  specialtyId?: string;
}

export interface CapacitySession {
  id: string;
  doctorId: string;
  roomId: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  firstComeFirstServe: boolean;
  firstComeCapacity: number;
  active: boolean;
}

export interface WorkingHours {
  days: number[];
  startTime: string;
  endTime: string;
  label: string;
}

export interface ServiceDurationProfile {
  averageMinutes: number;
  shortestMinutes: number;
  longestMinutes: number;
  serviceCount: number;
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const FALLBACK_WORKING_HOURS: WorkingHours = {
  days: [6, 0, 1, 2, 3, 4],
  startTime: "09:00",
  endTime: "23:00",
  label: "Saturday to Thursday, 9:00 AM to 11:00 PM",
};

function clock24(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const period = match[3].toUpperCase();
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseWorkingHours(value?: string | null): WorkingHours {
  if (!value?.trim()) return FALLBACK_WORKING_HOURS;
  const match = value.match(/(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+to\s+(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*,?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s+to\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i);
  if (!match) return { ...FALLBACK_WORKING_HOURS, label: value };
  const first = DAY_INDEX[match[1].toLowerCase()];
  const last = DAY_INDEX[match[2].toLowerCase()];
  const startTime = clock24(match[3]);
  const endTime = clock24(match[4]);
  if (first === undefined || last === undefined || !startTime || !endTime || minutesBetween(startTime, endTime) <= 0) {
    return { ...FALLBACK_WORKING_HOURS, label: value };
  }
  const days = [first];
  while (days.at(-1) !== last && days.length < 7) days.push((days.at(-1)! + 1) % 7);
  return { days, startTime, endTime, label: value };
}

export function minutesBetween(startTime: string, endTime: string): number {
  const minutes = (value: string) => {
    const [hour, minute] = value.slice(0, 5).split(":").map(Number);
    return hour * 60 + minute;
  };
  return Math.max(0, minutes(endTime) - minutes(startTime));
}

export function serviceDurationProfile(
  doctor: CapacityDoctor,
  services: CapacityService[],
  fallbackMinutes = 20,
): ServiceDurationProfile {
  const durations = services
    .filter((service) => {
      if (doctor.specialtyId && service.specialtyId !== doctor.specialtyId) return false;
      return service.assignedDoctorIds.length > 0
        ? service.assignedDoctorIds.includes(doctor.id)
        : service.doctorId === null || service.doctorId === doctor.id;
    })
    .map((service) => Math.floor(service.durationMinutes))
    .filter((duration) => duration > 0);
  if (durations.length === 0) {
    const fallback = Math.max(5, Math.floor(fallbackMinutes || 20));
    return { averageMinutes: fallback, shortestMinutes: fallback, longestMinutes: fallback, serviceCount: 0 };
  }
  return {
    averageMinutes: Math.max(5, Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)),
    shortestMinutes: Math.min(...durations),
    longestMinutes: Math.max(...durations),
    serviceCount: durations.length,
  };
}

export function sessionPatientCapacity(session: CapacitySession, profile: ServiceDurationProfile): number {
  if (!session.active) return 0;
  const sessionMinutes = minutesBetween(session.startTime, session.endTime);
  const planningDuration = Math.max(5, session.slotDurationMinutes, profile.averageMinutes);
  const serviceAdjustedCapacity = Math.floor(sessionMinutes / planningDuration);
  if (session.firstComeFirstServe) return Math.min(Math.max(0, session.firstComeCapacity), serviceAdjustedCapacity);
  return Math.max(0, serviceAdjustedCapacity);
}

export function eightyPercentGoal(capacity: number): number {
  return Math.ceil(Math.max(0, capacity) * 0.8);
}

export function mergedScheduledMinutes(sessions: Pick<CapacitySession, "startTime" | "endTime">[]): number {
  const intervals = sessions
    .map((session) => ({ start: session.startTime.slice(0, 5), end: session.endTime.slice(0, 5) }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start.localeCompare(b.start));
  if (intervals.length === 0) return 0;
  const merged = [intervals[0]];
  for (const interval of intervals.slice(1)) {
    const previous = merged.at(-1)!;
    if (interval.start <= previous.end) previous.end = previous.end > interval.end ? previous.end : interval.end;
    else merged.push(interval);
  }
  return merged.reduce((sum, interval) => sum + minutesBetween(interval.start, interval.end), 0);
}

export function occupancyPercent(scheduledMinutes: number, availableMinutes: number): number {
  if (availableMinutes <= 0) return 0;
  return Math.min(100, Math.round((Math.max(0, scheduledMinutes) / availableMinutes) * 100));
}
