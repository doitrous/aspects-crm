import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReservationStatusSelect } from "@/components/booking/ReservationStatusSelect";
import { getReservationsPage } from "@/lib/booking/reservations";
import { bookingConfigured } from "@/lib/booking/client";
import { syncReservationsToLeads } from "@/lib/booking/sync";
import { RESERVATION_STATUS_META, isNewReservation } from "@/lib/reservationStatus";
import { formatDate, formatClock } from "@/lib/format";
import type { Reservation } from "@/lib/types";
import { Card } from "@/components/ui/Card";
import { ReservationManagementControls } from "@/components/booking/ReservationManagementControls";
import { dismissedWebsiteReservationIds } from "@/lib/booking/reservationDismissals";
import { requireSession } from "@/lib/data/session";
import { can } from "@/lib/auth/permissions";
import { PaginationNav } from "@/components/ui/PaginationNav";

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

function pageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export default async function ReservationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { effective: user } = await requireSession();
  const canManageReservations = can(user.role, "reservations.manage");
  if (!bookingConfigured()) {
    return (
      <>
        <Topbar title="Website Reservations" />
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
  const requestedPage = pageNumber((await searchParams).page);
  const reservationPage = await getReservationsPage(requestedPage, 100);
  const allReservations = reservationPage.reservations;
  const leadByAppointment = await syncReservationsToLeads(allReservations);
  const dismissedIds = await dismissedWebsiteReservationIds();
  const reservations = allReservations.filter((reservation) => !dismissedIds.has(reservation.id));
  const newCount = reservations.filter((r) => isNewReservation(r.status, r.createdAt, now)).length;
  const adjustedTotal = Math.max(0, reservationPage.total - dismissedIds.size);
  const pageCount = Math.max(1, Math.ceil(adjustedTotal / reservationPage.pageSize));
  const hrefForPage = (page: number) => page > 1 ? `/reservations?page=${page}` : "/reservations";

  return (
    <>
      <Topbar title="Website Reservations" unread={newCount} />
      <div className="flex-1 overflow-auto bg-canvas px-[18px] py-4">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["All reservations", adjustedTotal, "border-blue-200 bg-blue-50 text-blue-800"],
            ["New on this page", newCount, "border-violet-200 bg-violet-50 text-violet-800"],
            ["Confirmed on page", reservations.filter((r) => r.status === "confirmed").length, "border-emerald-200 bg-emerald-50 text-emerald-800"],
            ["Needs review on page", reservations.filter((r) => r.status === "reserved").length, "border-amber-200 bg-amber-50 text-amber-800"],
          ].map(([label, value, cls]) => <div key={String(label)} className={`rounded-xl border p-3 ${cls}`}><div className="text-[10.5px] font-bold uppercase tracking-wide opacity-70">{label}</div><div className="mt-1 text-[22px] font-black">{value}</div></div>)}
        </div>
        <div className="mb-3 flex items-center justify-between"><div><h2 className="text-[15px] font-black text-ink-900">Website booking queue</h2><p className="text-[11.5px] text-ink-500">Live from the booking website · every reservation is linked to the patient Database</p></div><span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10.5px] font-bold text-emerald-700">● Live sync</span></div>

        {reservations.length === 0 ? (
          <EmptyState
            title="No reservations yet"
            hint="New patient bookings from the website will appear here in real time."
          />
        ) : (
          <>
          <PaginationNav page={reservationPage.page} pageCount={pageCount} hrefForPage={hrefForPage} />
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-[18px] py-2.5">Lead · Patient</th>
                  <th className="px-3 py-2.5">Contact</th>
                  <th className="px-3 py-2.5">Doctor · Specialty</th>
                  <th className="px-3 py-2.5">Branch</th>
                  <th className="px-3 py-2.5">Appointment</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Update</th>
                  <th className="px-3 py-2.5 pr-[18px]">Booked</th>
                  {canManageReservations && <th className="px-3 py-2.5 pr-[18px]">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {reservations.map((r) => {
                  const isNew = isNewReservation(r.status, r.createdAt, now);
                  const syncedLead = leadByAppointment.get(r.id);
                  const leadId = syncedLead?.leadId;
                  return (
                    <tr
                      key={r.id}
                      className={
                        "border-b border-line-faint hover:bg-primary-soft/30 " +
                        (isNew ? "bg-primary-soft/20" : "")
                      }
                    >
                      <td className="px-[18px] py-3">
                        <Link href={leadId ? `/leads/${leadId}?tab=Booking` : "/reservations"} className="group block">
                          <div className="flex items-center gap-2">
                            {isNew && (
                              <span className="rounded-pill bg-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                New
                              </span>
                            )}
                            {syncedLead?.revisiting && (
                              <span className="rounded-pill border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-violet-700">
                                Revisiting Patient
                              </span>
                            )}
                            {leadId && <span className="font-mono text-[10.5px] text-ink-400">{leadId}</span>}
                          </div>
                          <span className="font-semibold text-ink-900 group-hover:text-primary">{r.patientName}</span>
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-400">
                          <span>{syncedLead?.revisiting ? "Revisiting patient" : r.isNewPatient ? "New patient" : "Returning"}</span>
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
                      <td className="px-3 py-3">
                        <ReservationStatusSelect appointmentId={r.id} leadId={leadId} status={r.status} />
                      </td>
                      <td className="px-3 py-3 pr-[18px] text-ink-500">{formatDate(r.createdAt)}</td>
                      {canManageReservations && <td className="px-3 py-3 pr-[18px]"><ReservationManagementControls appointmentId={r.id} patientName={r.patientName} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <PaginationNav page={reservationPage.page} pageCount={pageCount} hrefForPage={hrefForPage} />
          </>
        )}
      </div>
    </>
  );
}
