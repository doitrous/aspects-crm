/**
 * Display formatters. The clinic standard for ALL visible dates is
 * "Jun 06, 2026" (short month, zero-padded day, full year).
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function toDate(input: string | Date): Date {
  return input instanceof Date ? input : new Date(input);
}

/** e.g. "Jun 06, 2026" */
export function formatDate(input: string | Date): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "—";
  const mon = MONTHS[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  return `${mon} ${day}, ${d.getFullYear()}`;
}

/** e.g. "9:35 AM" */
export function formatTime(input: string | Date): string {
  const d = toDate(input);
  if (Number.isNaN(d.getTime())) return "—";
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** Format a bare "HH:MM" (24h) clock string to "4:20 PM". */
export function formatClock(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(":");
  const h = Number(hRaw);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${(mRaw ?? "00").padStart(2, "0")} ${ampm}`;
}

/** e.g. "Jun 06, 2026 · 9:35 AM" */
export function formatDateTime(input: string | Date): string {
  return `${formatDate(input)} · ${formatTime(input)}`;
}

/** Compact relative age used for SLA / "waiting" labels, e.g. "12m", "3h", "2d". */
export function formatAge(input: string | Date, now: Date = new Date()): string {
  const d = toDate(input);
  const diffMs = Math.max(0, now.getTime() - d.getTime());
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}
