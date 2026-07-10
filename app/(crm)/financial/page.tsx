import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { Card } from "@/components/ui/Card";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import {
  financialDashboard,
  exceptionalCases,
  type RevenueBreakdownRow,
} from "@/lib/data/financialDashboard";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function egp(n: number): string {
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} EGP`;
}
function pct(n: number): string {
  return `${n}%`;
}
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: isoDay(from), to: isoDay(to) };
}
function parseDay(v: string | undefined, fallback: string): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

function Kpi({
  label,
  value,
  sub,
  flag,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  flag?: boolean;
  href?: string;
}) {
  const body = (
    <div className={"rounded-control border p-3 " + (flag ? "border-red-300 bg-red-50" : "border-line-soft bg-panel")}>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-0.5 text-[17px] font-bold text-ink-900">{value}</div>
      {sub && <div className="text-[10.5px] text-ink-500">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition-colors hover:opacity-90">{body}</Link>
  ) : (
    body
  );
}

function Breakdown({ title, rows }: { title: string; rows: RevenueBreakdownRow[] }) {
  const top = rows.slice(0, 8);
  return (
    <Card className="p-3">
      <div className="mb-2 text-[12px] font-bold text-ink-800">{title}</div>
      {top.length === 0 ? (
        <div className="text-[12px] text-ink-400">No records in range.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {top.map((r) => (
            <div key={r.key} className="flex items-center justify-between text-[12px]">
              <span className="truncate text-ink-700">{r.label}</span>
              <span className="ml-2 whitespace-nowrap font-semibold text-ink-900">
                {egp(r.recognizedRevenue)} <span className="text-ink-400">· {r.recordCount}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const STATUS_CLS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  approved_with_modified_price: "bg-emerald-100 text-emerald-700",
  force_approved: "bg-red-100 text-red-700",
  rejected: "bg-line-faint text-ink-500",
  resolved: "bg-line-faint text-ink-500",
};

/**
 * Financial Dashboard (§1). Admin/Auditor only. Every figure is aggregated from
 * the canonical financial tables via `financialDashboard` — no hard-coded
 * numbers, no second dataset. Two clearly-labelled date bases: cash flow on the
 * transaction date, profitability on the service date.
 */
export default async function FinancialPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; tab?: string; status?: string }>;
}) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "financial.viewReports")) notFound();

  const sp = await searchParams;
  const def = defaultRange();
  const range = { from: parseDay(sp.from, def.from), to: parseDay(sp.to, def.to) };
  const tab = sp.tab === "exceptions" ? "exceptions" : "overview";

  const fieldCls = "rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary";

  return (
    <>
      <Topbar title="Financial Dashboard" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <form method="get" action="/financial" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="tab" value={tab} />
            <label className="text-[11px] font-semibold text-ink-500">From</label>
            <input type="date" name="from" defaultValue={range.from} className={fieldCls} />
            <label className="text-[11px] font-semibold text-ink-500">To</label>
            <input type="date" name="to" defaultValue={range.to} className={fieldCls} />
            <button type="submit" className="h-8 rounded-control border border-line-soft px-3 text-[12px] font-semibold text-ink-700 hover:bg-line-faint/60">Apply</button>
          </form>
          <div className="ml-auto flex gap-1 rounded-lg bg-line-faint/60 p-0.5">
            <Link href={`/financial?from=${range.from}&to=${range.to}`} className={"rounded-md px-3 py-1 text-[12px] font-semibold " + (tab === "overview" ? "bg-primary text-white" : "text-ink-600")}>Overview</Link>
            <Link href={`/financial?from=${range.from}&to=${range.to}&tab=exceptions`} className={"rounded-md px-3 py-1 text-[12px] font-semibold " + (tab === "exceptions" ? "bg-primary text-white" : "text-ink-600")}>Exceptional pricing</Link>
          </div>
          <Link href="/financial/import" className="h-8 rounded-control bg-primary px-3 text-[12px] font-semibold leading-8 text-white hover:bg-primary-hover">
            Bulk import
          </Link>
        </div>

        {tab === "overview" ? (
          <OverviewTab range={range} />
        ) : (
          <ExceptionsTab status={sp.status} />
        )}
      </div>
    </>
  );
}

async function OverviewTab({ range }: { range: { from: string; to: string } }) {
  const d = await financialDashboard(range);
  const p = d.profitability;
  const c = d.cashFlow;

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">
          Cash flow — based on actual transaction date
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Kpi label="Net cash collected" value={egp(c.netCash)} />
          <Kpi label="Gross collected" value={egp(c.collected)} />
          <Kpi label="Refunds" value={egp(c.refunds)} flag={c.refunds > 0} />
          <Kpi label="Reversals" value={egp(c.reversals)} flag={c.reversals > 0} />
          <Kpi label="Chargebacks" value={egp(c.chargebacks)} flag={c.chargebacks > 0} />
          <Kpi label="Doctor-funded" value={egp(c.doctorFunded)} />
        </div>
        {c.byMethod.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {c.byMethod.map((m) => (
              <span key={m.method} className="rounded-pill bg-line-faint px-2.5 py-1 text-[11.5px] font-medium text-ink-700">
                {m.method}: <span className="font-bold text-ink-900">{egp(m.amount)}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">
          Profitability — based on service/procedure date
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Kpi label="Gross service value" value={egp(p.grossServiceValue)} />
          <Kpi label="Total quoted" value={egp(p.totalQuotedValue)} />
          <Kpi label="Discounts given" value={egp(p.totalDiscounts)} />
          <Kpi label="Recognized revenue" value={egp(p.recognizedRevenue)} sub={`${p.recordCount} records`} />
          <Kpi label="Consumables" value={egp(p.consumablesTotal)} />
          <Kpi label="Doctor compensation" value={egp(p.doctorCompensationTotal)} />
          <Kpi label="External costs" value={egp(p.externalCostsTotal)} />
          <Kpi label="Total direct costs" value={egp(p.totalDirectCosts)} />
          <Kpi label="Net revenue" value={egp(p.netRevenue)} flag={p.netRevenue < 0} />
          <Kpi label="Net margin %" value={pct(p.netMarginPercent)} flag={p.netMarginPercent < 0} />
          <Kpi label="Outstanding (all leads)" value={egp(d.outstandingCurrent)} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-500">Exceptions</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Exceptional-price records" value={String(d.exceptionalCount)} flag={d.exceptionalCount > 0}
               href={`/financial?from=${range.from}&to=${range.to}&tab=exceptions`} />
          <Kpi label="Pending approvals" value={String(d.pendingApprovals)} flag={d.pendingApprovals > 0}
               href={`/financial?tab=exceptions&status=pending`} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Breakdown title="Revenue by doctor" rows={d.byDoctor} />
        <Breakdown title="Revenue by service" rows={d.byService} />
        <Breakdown title="Revenue by source" rows={d.bySource} />
      </section>
    </div>
  );
}

async function ExceptionsTab({ status }: { status?: string }) {
  const cases = await exceptionalCases(status);
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-[12px]">
        <thead>
          <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <th className="px-3 py-2">Lead</th>
            <th className="px-3 py-2">Base</th>
            <th className="px-3 py-2">Requested</th>
            <th className="px-3 py-2">Eff. disc.</th>
            <th className="px-3 py-2">Allowed</th>
            <th className="px-3 py-2">Approved price</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Requested by</th>
            <th className="px-3 py-2">Decided by</th>
            <th className="px-3 py-2">Reason</th>
            <th className="px-3 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {cases.length === 0 ? (
            <tr><td colSpan={11} className="px-3 py-6 text-center text-ink-400">No exceptional pricing cases.</td></tr>
          ) : (
            cases.map((x) => (
              <tr key={x.id} className="border-b border-line-faint align-top">
                <td className="px-3 py-2">
                  {x.leadHumanId ? (
                    <Link href={`/leads/${x.leadHumanId}?tab=Payments`} className="font-mono text-[11px] font-semibold text-primary hover:underline">
                      {x.leadHumanId}
                    </Link>
                  ) : "—"}
                </td>
                <td className="px-3 py-2 text-ink-700">{egp(x.basePrice)}</td>
                <td className="px-3 py-2 text-ink-700">{egp(x.requestedQuotedPrice)}</td>
                <td className="px-3 py-2 font-semibold text-red-600">{x.requestedPct}%</td>
                <td className="px-3 py-2 text-ink-600">{x.maxAllowedPct}%</td>
                <td className="px-3 py-2 text-ink-700">{x.approvedQuotedPrice != null ? egp(x.approvedQuotedPrice) : "—"}</td>
                <td className="px-3 py-2">
                  <span className={"rounded-pill px-2 py-0.5 text-[10px] font-semibold " + (STATUS_CLS[x.status] ?? "bg-line-faint text-ink-500")}>
                    {x.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-700">{x.requestedByName ?? "—"}</td>
                <td className="px-3 py-2 text-ink-700">{x.decidedByName ?? "—"}</td>
                <td className="px-3 py-2 text-ink-500">{x.reason ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ink-500">{formatDate(x.createdAt)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}
