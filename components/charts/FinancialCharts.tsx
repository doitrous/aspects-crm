import type { FinancialDashboardData, RevenueBreakdownRow } from "@/lib/data/financialDashboard";

function points(values: number[], width = 520, height = 150): string {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  return values.map((value, index) => `${values.length === 1 ? width / 2 : (index / (values.length - 1)) * width},${height - ((value - min) / span) * (height - 18) - 9}`).join(" ");
}

function EmptyChart() { return <div className="flex h-[170px] items-center justify-center text-[11.5px] text-ink-400">No activity in this date range.</div>; }

function LineChart({ title, subtitle, rows, value, color }: { title: string; subtitle: string; rows: Array<{ day: string }>; value: (row: { day: string }) => number; color: string }) {
  const values = rows.map(value);
  return <section className="rounded-xl border border-line bg-panel p-4 shadow-sm"><div className="mb-3"><h3 className="text-[14px] font-black text-ink-900">{title}</h3><p className="mt-0.5 text-[10.5px] text-ink-400">{subtitle}</p></div>{rows.length ? <><svg viewBox="0 0 520 150" className="h-[150px] w-full" role="img" aria-label={title}><line x1="0" x2="520" y1="141" y2="141" stroke="#e4e7ec"/><polyline fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" points={points(values)} /></svg><div className="mt-1 flex justify-between text-[9.5px] font-semibold text-ink-400"><span>{rows[0]?.day}</span><span>{rows.at(-1)?.day}</span></div></> : <EmptyChart />}</section>;
}

function MixChart({ rows }: { rows: RevenueBreakdownRow[] }) {
  const top = rows.slice(0, 6); const max = Math.max(...top.map((row) => row.recognizedRevenue), 1);
  return <section className="rounded-xl border border-line bg-panel p-4 shadow-sm"><div className="mb-4"><h3 className="text-[14px] font-black text-ink-900">Revenue mix</h3><p className="mt-0.5 text-[10.5px] text-ink-400">Top services by recognized revenue</p></div>{top.length ? <div className="space-y-3">{top.map((row) => <div key={row.key}><div className="mb-1 flex items-center justify-between gap-3 text-[10.5px]"><span className="truncate font-bold text-ink-700">{row.label}</span><span className="font-mono font-bold text-ink-500">{row.recognizedRevenue.toLocaleString()} EGP</span></div><div className="h-2 overflow-hidden rounded-full bg-line-faint"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, row.recognizedRevenue / max * 100)}%` }} /></div></div>)}</div> : <EmptyChart />}</section>;
}

export function FinancialCharts({ data }: { data: FinancialDashboardData }) {
  return <div><div className="mb-2 flex items-center justify-between"><h2 className="text-[12px] font-black uppercase tracking-[0.12em] text-ink-500">Live range analysis</h2><span className="text-[10px] text-ink-400">Updates when dates change</span></div><div className="grid gap-3 xl:grid-cols-3"><LineChart title="Daily collections" subtitle="Completed patient payments by transaction date" rows={data.cashFlow.byDay} value={(row) => (row as FinancialDashboardData["cashFlow"]["byDay"][number]).amount} color="#2f6fed" /><LineChart title="Daily net profit" subtitle="Revenue less direct costs by service date" rows={data.profitByDay} value={(row) => (row as FinancialDashboardData["profitByDay"][number]).profit} color="#059669" /><MixChart rows={data.byService} /></div></div>;
}
