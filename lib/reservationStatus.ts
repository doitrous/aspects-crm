import type { ReservationStatus } from "@/lib/types";

/** Badge palette + label for each booking-platform appointment status.
 *  Mirrors the booking admin dashboard's status model (same rules), rendered
 *  in the CRM's own visual language. */
export const RESERVATION_STATUS_META: Record<
  ReservationStatus,
  { label: string; bg: string; fg: string; dot: string }
> = {
  reserved: { label: "Reserved", bg: "#fffaeb", fg: "#b54708", dot: "#f79009" },
  confirmed: { label: "Confirmed", bg: "#eff8ff", fg: "#175cd3", dot: "#2e90fa" },
  attended: { label: "Attended", bg: "#ecfdf3", fg: "#067647", dot: "#12b76a" },
  no_show: { label: "No-show", bg: "#fef3f2", fg: "#b42318", dot: "#f04438" },
  cancelled: { label: "Cancelled", bg: "#f2f4f7", fg: "#667085", dot: "#98a2b3" },
  rescheduled: { label: "Rescheduled", bg: "#eef2ff", fg: "#4338ca", dot: "#7a5af8" },
};

/** Active statuses that occupy a slot for double-booking purposes — matches the
 *  booking API's conflict check (`status in ('reserved','confirmed')`). */
export const ACTIVE_STATUSES: ReservationStatus[] = ["reserved", "confirmed"];

/** A reservation is treated as "new / unread" until the clinic confirms it, and
 *  for the first 48h after it was booked. This is a live proxy until CRM-side
 *  read-state is persisted via the booking→CRM ingest push. */
export function isNewReservation(createdAt: string, now: number = Date.now()): boolean {
  const age = now - new Date(createdAt).getTime();
  return age >= 0 && age < 48 * 60 * 60 * 1000;
}
