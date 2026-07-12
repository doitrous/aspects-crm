import { Sidebar } from "@/components/shell/Sidebar";
import { dashboardMetrics } from "@/lib/data";
import { getReservations } from "@/lib/booking/reservations";
import { isNewReservation } from "@/lib/reservationStatus";
import { listAccounts, requireSession } from "@/lib/data/session";
import { I18nProvider } from "@/lib/i18n/context";
import { getPreferences } from "@/lib/i18n/server";
import { ArabicPageTranslator } from "@/components/i18n/ArabicPageTranslator";

/** New/unread reservation count for the sidebar badge. Isolated from the shell:
 *  a booking-platform outage must never break CRM navigation. */
async function newReservationCount(): Promise<number> {
  try {
    const res = await getReservations();
    return res.filter((r) => isNewReservation(r.status, r.createdAt)).length;
  } catch {
    return 0;
  }
}

/**
 * CRM shell. Fills the whole viewport (no centered max-width card). The
 * `modal` parallel slot hosts the lead slide-over so a lead can be opened as a
 * drawer from anywhere in the app — not just the leads list — via the
 * intercepting route at `@modal/(.)leads/[id]`.
 */
export default async function CrmLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  // Authenticate before touching any CRM data: an anonymous request must be
  // redirected, not served a dashboard query.
  const { effective: user, canImpersonate } = await requireSession();

  const [m, reservations, accounts, prefs] = await Promise.all([
    dashboardMetrics(),
    newReservationCount(),
    canImpersonate ? listAccounts() : Promise.resolve([]),
    getPreferences(),
  ]);
  const counts: Record<string, number> = {
    newLeads: m.newLeads,
    qualified: m.qualified,
    booked: m.booked,
    followUp: m.followUp,
    lost: m.lost,
    duplicates: m.duplicates,
    escalations: m.escalations,
    reservations,
  };

  return (
    <I18nProvider locale={prefs.locale}>
      <ArabicPageTranslator />
      <div className="flex h-screen overflow-hidden bg-panel">
        <Sidebar
          counts={counts}
          user={user}
          accounts={accounts}
          canImpersonate={canImpersonate}
          impersonating={user.impersonating}
          theme={prefs.theme}
        />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
        {modal}
      </div>
    </I18nProvider>
  );
}
