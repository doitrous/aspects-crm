import type { BookingStatus, ReservationStatus } from "@/lib/types";

const KNOWN = new Set<ReservationStatus>([
  "reserved",
  "confirmed",
  "rescheduled",
  "cancelled",
  "attended",
  "no_show",
]);

function statusMap(metadata: Record<string, unknown> | null | undefined, legacyId?: string | null) {
  const raw = metadata?.booking_status_by_id;
  const result: Record<string, ReservationStatus> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "string" && KNOWN.has(value as ReservationStatus)) {
        result[id] = value as ReservationStatus;
      }
    }
  }
  const legacyStatus = metadata?.booking_status;
  if (legacyId && !result[legacyId] && typeof legacyStatus === "string" && KNOWN.has(legacyStatus as ReservationStatus)) {
    result[legacyId] = legacyStatus as ReservationStatus;
  }
  return result;
}

export interface LeadBookingSummary {
  status: BookingStatus;
  context?: string;
  count: number;
}

/** Derive one truthful badge plus enough context for mixed appointment histories. */
export function deriveLeadBookingSummary(
  metadata: Record<string, unknown> | null | undefined,
  legacyId?: string | null,
): LeadBookingSummary {
  const values = Object.values(statusMap(metadata, legacyId));
  const count = values.length || (legacyId ? 1 : 0);
  if (count === 0) return { status: "none", count: 0 };

  const tally = (status: ReservationStatus) => values.filter((value) => value === status).length;
  const confirmed = tally("confirmed") + tally("rescheduled");
  const awaiting = tally("reserved");
  const active = confirmed + awaiting;
  const attended = tally("attended");
  const cancelled = tally("cancelled");
  const noShow = tally("no_show");

  if (active > 0) {
    const parts = [
      confirmed ? `${confirmed} confirmed` : "",
      awaiting ? `${awaiting} awaiting confirmation` : "",
      count > active ? `${count - active} previous` : "",
    ].filter(Boolean);
    return {
      status: confirmed > 0 ? "confirmed" : "unconfirmed",
      count,
      context: count > 1 ? `${count} bookings · ${parts.join(" · ")}` : parts[0],
    };
  }
  if (attended > 0) {
    return {
      status: "completed",
      count,
      context: count > 1 ? `${count} bookings · ${attended} attended${cancelled ? ` · ${cancelled} cancelled` : ""}${noShow ? ` · ${noShow} no-show` : ""}` : "Appointment attended",
    };
  }
  if (noShow > 0) {
    return { status: "no_show", count, context: count > 1 ? `${count} bookings · ${noShow} no-show · ${cancelled} cancelled` : "Patient did not attend" };
  }
  return { status: "cancelled", count, context: count > 1 ? `All ${count} bookings cancelled` : "Booking cancelled" };
}

export function withBookingStatus(
  metadata: Record<string, unknown> | null | undefined,
  appointmentId: string,
  status: ReservationStatus,
  origin?: "crm" | "website",
): Record<string, unknown> {
  const current = metadata ?? {};
  const statusById = statusMap(current, null);
  statusById[appointmentId] = status;
  const rawOrigins = current.booking_origin_by_id;
  const originById = rawOrigins && typeof rawOrigins === "object" && !Array.isArray(rawOrigins)
    ? { ...(rawOrigins as Record<string, unknown>) }
    : {};
  if (origin) originById[appointmentId] = origin;
  return {
    ...current,
    booking_status: status,
    booking_status_by_id: statusById,
    booking_origin_by_id: originById,
  };
}
