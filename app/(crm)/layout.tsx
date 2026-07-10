import { Sidebar } from "@/components/shell/Sidebar";
import { dashboardMetrics } from "@/lib/data";
import { getReservations } from "@/lib/booking/reservations";
import { isNewReservation } from "@/lib/reservationStatus";

/** New/unread reservation count for the sidebar badge. Isolated from the shell:
 *  a booking-platform outage must never break CRM navigation. */
async function newReservationCount(): Promise<number> {
  try {
    const res = await getReservations();
    return res.filter((r) => isNewReservation(r.createdAt)).length;
  } catch {
    return 0;
  }
}

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const [m, reservations] = await Promise.all([dashboardMetrics(), newReservationCount()]);
  const counts: Record<string, number> = {
    newLeads: m.newLeads,
    followUp: m.followUp,
    duplicates: m.duplicates,
    escalations: m.escalations,
    reservations,
  };

  return (
    <div className="mx-auto max-w-[1360px] px-5 py-6">
      <div className="flex h-[calc(100vh-48px)] min-h-[760px] overflow-hidden rounded-card border border-line bg-panel shadow-card">
        <Sidebar counts={counts} />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
