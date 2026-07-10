import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { getReservations } from "@/lib/booking/reservations";
import { bookingConfigured } from "@/lib/booking/client";
import { RESERVATION_STATUS_META, isNewReservation } from "@/lib/reservationStatus";
import { formatDate, formatClock } from "@/lib/format";
import type { Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: Reservation["status"] }) {
  const m = RESERVATION_STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold"
      style={{ background: m.bg, color: m.fg }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

export default async function ReservationsPage() {
  if (!bookingConfigured()) {
    return (
      <>
        <Topbar title="Patient Reservations" />
        <div className="flex-1 overflow-auto">
          <EmptyState
            title="Booking integration not connected"
            hint="Set BOOKING_SUPABASE_URL and BOOKING_SUPABASE_SERVICE_ROLE_KEY in .env.local to stream live reservations from the website."
          />
        </div>
      </>
    );
  }

  const now = Date.now();
  const reservations = await getReservations();
  const newCount = reservations.filter((r) => isNewReservation(r.createdAt, now)).length;

  return (
    <>
      <Topbar title="Patient Reservations" unread={newCount} />
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          {reservations.length} reservation{reservations.length === 1 ? "" : "s"} · {newCount} new ·
          live from the booking website
        </div>

        {reservations.length === 0 ? (
          <EmptyState
            title="No reservations yet"
            hint="New patient bookings from the website will appear here in real time."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-[18px] py-2.5">Patient</th>
                  <th className="px-3 py-2.5">Contact</th>
                  <th className="px-3 py-2.5">Doctor · Specialty</th>
                  <th className="px-3 py-2.5">Branch</th>
                  <th className="px-3 py-2.5">Appointment</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 pr-[18px]">Booked</th>
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const isNew = isNewReservation(r.createdAt, now);
                  return (
                    <tr
                      key={r.id}
                      className={
                        "border-b border-line-faint hover:bg-primary-soft/30 " +
                        (isNew ? "bg-primary-soft/20" : "")
                      }
                    >
                      <td className="px-[18px] py-3">
                        <div className="flex items-center gap-2">
                          {isNew && (
                            <span className="rounded-pill bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                              New
                            </span>
                          )}
                          <span className="font-semibold text-ink-900">{r.patientName}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
                          <span>{r.isNewPatient ? "New patient" : "Returning"}</span>
                          {r.patientAge ? <span>· {r.patientAge}y</span> : null}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-ink-600">
                        <div className="font-medium text-ink-700">{r.patientPhone || "—"}</div>
                        {r.patientEmail && (
                          <div className="text-[11px] text-ink-400">{r.patientEmail}</div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-ink-800">{r.doctorName ?? "—"}</div>
                        <div className="text-[11px] text-ink-400">{r.specialtyName ?? ""}</div>
                        {r.serviceName && (
                          <div className="text-[11px] text-ink-400">{r.serviceName}</div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-ink-600">{r.branchName ?? "—"}</td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-ink-800">{formatDate(r.date)}</div>
                        <div className="text-[11px] text-ink-500">
                          {formatClock(r.startTime)} – {formatClock(r.endTime)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-3 py-3 pr-[18px] text-ink-500">{formatDate(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
