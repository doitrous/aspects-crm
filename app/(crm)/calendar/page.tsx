import Link from "next/link";
import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { getReservations } from "@/lib/booking/reservations";
import { bookingConfigured } from "@/lib/booking/client";
import { RESERVATION_STATUS_META } from "@/lib/reservationStatus";
import { formatClock } from "@/lib/format";
import type { Reservation } from "@/lib/types";

export const dynamic = "force-dynamic";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** YYYY-MM-DD from a UTC date. */
function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse a `?month=YYYY-MM` param, falling back to the current month. */
function parseMonth(raw?: string): { year: number; month: number } {
  if (raw && /^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

function monthParam(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** Build the 6-week (42-cell) Sun→Sat grid covering the given month. */
function buildGrid(year: number, month: number): { key: string; day: number; inMonth: boolean }[] {
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - first.getUTCDay()); // back to Sunday
  const cells: { key: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({ key: ymd(d), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month });
  }
  return cells;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  if (!bookingConfigured()) {
    return (
      <>
        <Topbar title="Calendar" />
        <div className="flex-1 overflow-auto">
          <EmptyState
            title="Booking integration not connected"
            hint="Set BOOKING_SUPABASE_URL and BOOKING_SUPABASE_SERVICE_ROLE_KEY in .env.local to sync the live booking calendar."
          />
        </div>
      </>
    );
  }

  const { month: monthParamRaw } = await searchParams;
  const { year, month } = parseMonth(monthParamRaw);
  const grid = buildGrid(year, month);
  const rangeFrom = grid[0].key;
  const rangeTo = grid[grid.length - 1].key;
  const now = new Date();
  const todayKey = ymd(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
  const monthPrefix = monthParam(year, month);

  // Same rule as the booking admin calendar: cancelled reservations don't occupy the grid.
  const all = await getReservations({ from: rangeFrom, to: rangeTo });
  const reservations = all.filter((r) => r.status !== "cancelled");

  const byDate = new Map<string, Reservation[]>();
  for (const r of reservations) {
    const list = byDate.get(r.date) ?? [];
    list.push(r);
    byDate.set(r.date, list);
  }
  // Each day's reservations sorted by start time.
  for (const list of byDate.values()) list.sort((a, b) => a.startTime.localeCompare(b.startTime));

  const inMonthCount = reservations.filter((r) => r.date.startsWith(monthPrefix)).length;

  const prev = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
  const next = month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
  const nav = (t: { year: number; month: number }) => `/calendar?month=${monthParam(t.year, t.month)}`;

  return (
    <>
      <Topbar title="Calendar" />
      <div className="flex-1 overflow-auto p-[18px]">
        {/* Month header + navigation */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-bold text-ink-900">
              {MONTHS[month]} {year}
            </div>
            <div className="mt-0.5 text-[11.5px] text-ink-400">
              {inMonthCount} reservation{inMonthCount === 1 ? "" : "s"} this month · live from the
              booking website · cancelled hidden
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={nav(prev)}
              className="flex h-8 items-center rounded-control border border-line px-2.5 text-[12px] text-ink-600 hover:bg-line-faint"
              aria-label="Previous month"
            >
              ‹
            </Link>
            <Link
              href="/calendar"
              className="flex h-8 items-center rounded-control border border-line px-3 text-[12px] font-medium text-primary hover:bg-primary-soft/40"
            >
              This month
            </Link>
            <Link
              href={nav(next)}
              className="flex h-8 items-center rounded-control border border-line px-2.5 text-[12px] text-ink-600 hover:bg-line-faint"
              aria-label="Next month"
            >
              ›
            </Link>
          </div>
        </div>

        {/* Legend */}
        <div className="mb-2.5 flex flex-wrap gap-x-3 gap-y-1">
          {Object.entries(RESERVATION_STATUS_META)
            .filter(([s]) => s !== "cancelled")
            .map(([s, m]) => (
              <span key={s} className="flex items-center gap-1.5 text-[10.5px] text-ink-400">
                <span className="h-2 w-2 rounded-full" style={{ background: m.dot }} />
                {m.label}
              </span>
            ))}
        </div>

        {/* Calendar grid */}
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-7 gap-px">
              {DOW.map((d) => (
                <div
                  key={d}
                  className="pb-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wide text-ink-400"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {grid.map((cell) => {
                const dayRes = byDate.get(cell.key) ?? [];
                const isToday = cell.key === todayKey;
                return (
                  <div
                    key={cell.key}
                    className={
                      "flex min-h-[112px] flex-col rounded-control border p-1.5 " +
                      (cell.inMonth ? "border-line bg-panel" : "border-line-faint bg-line-faint/40")
                    }
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={
                          "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold " +
                          (isToday
                            ? "bg-primary text-white"
                            : cell.inMonth
                              ? "text-ink-700"
                              : "text-ink-300")
                        }
                      >
                        {cell.day}
                      </span>
                      {dayRes.length > 0 && (
                        <span className="text-[10px] font-semibold text-ink-400">
                          {dayRes.length}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      {dayRes.slice(0, 3).map((r) => {
                        const meta = RESERVATION_STATUS_META[r.status];
                        return (
                          <div
                            key={r.id}
                            className="rounded-[5px] px-1.5 py-1 text-[10.5px] leading-tight"
                            style={{ background: meta.bg }}
                            title={`${formatClock(r.startTime)} · ${r.patientName} · ${r.doctorName ?? ""} · ${meta.label}`}
                          >
                            <div className="flex items-center gap-1">
                              <span
                                className="h-1.5 w-1.5 flex-none rounded-full"
                                style={{ background: meta.dot }}
                              />
                              <span className="font-semibold" style={{ color: meta.fg }}>
                                {formatClock(r.startTime)}
                              </span>
                            </div>
                            <div className="truncate text-ink-800">{r.patientName}</div>
                            {r.doctorName && (
                              <div className="truncate text-ink-400">{r.doctorName}</div>
                            )}
                          </div>
                        );
                      })}
                      {dayRes.length > 3 && (
                        <div className="px-1 text-[10px] font-medium text-ink-400">
                          +{dayRes.length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
