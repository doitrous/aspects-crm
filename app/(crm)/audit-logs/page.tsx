import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { listActivity, type ActivityRow } from "@/lib/audit/log";
import { formatDateTime } from "@/lib/format";
import { PaginationNav } from "@/components/ui/PaginationNav";

export const dynamic = "force-dynamic";

type SP = {
  entity?: string;
  action?: string;
  user?: string;
  role?: string;
  lead?: string;
  from?: string;
  to?: string;
  page?: string;
};

function ChangeCell({ row }: { row: ActivityRow }) {
  const keys = [...new Set([...Object.keys(row.oldValues), ...Object.keys(row.newValues)])]
    .filter((k) => k !== "source")
    .slice(0, 8);
  if (keys.length === 0) return <span className="text-ink-400">-</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {keys.map((k) => {
        const oldV = row.oldValues[k];
        const newV = row.newValues[k];
        const fmt = (v: unknown) =>
          v === undefined || v === null || v === "" ? "empty" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return (
          <div key={k} className="text-[11px]">
            <span className="font-mono text-ink-500">{k}: </span>
            {k in row.oldValues && <span className="text-ink-400 line-through">{fmt(oldV)}</span>}
            {k in row.oldValues && k in row.newValues && <span className="text-ink-400"> {"->"} </span>}
            {k in row.newValues && <span className="font-medium text-ink-800">{fmt(newV)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "audit.view")) notFound();

  const sp = await searchParams;
  const allRows = await listActivity({
    entityType: sp.entity?.trim() || undefined,
    action: sp.action?.trim() || undefined,
    actorId: sp.user?.trim() || undefined,
    actorRole: sp.role?.trim() || undefined,
    leadId: sp.lead?.trim() || undefined,
    dateFrom: sp.from || undefined,
    dateTo: sp.to || undefined,
    limit: 500,
  });
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const pageSize = 30;
  const rows = allRows.slice((page - 1) * pageSize, page * pageSize);
  const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
  const pageHref = (next: number) => {
    const params = new URLSearchParams(Object.entries(sp).filter(([key, value]) => key !== "page" && Boolean(value)) as Array<[string, string]>);
    params.set("page", String(next));
    return `/audit-logs?${params.toString()}`;
  };

  const fieldCls =
    "h-[32px] rounded-control border border-line px-2.5 text-[12px] text-ink-800 outline-none focus:border-primary bg-panel";

  return (
    <>
      <Topbar title="Audit Logs" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <form method="get" className="mb-3 grid gap-2 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto_auto]">
          <input name="lead" defaultValue={sp.lead ?? ""} placeholder="Lead ID" className={fieldCls} />
          <input name="entity" defaultValue={sp.entity ?? ""} placeholder="Entity type" className={fieldCls} />
          <input name="action" defaultValue={sp.action ?? ""} placeholder="Action" className={fieldCls} />
          <select name="role" defaultValue={sp.role ?? ""} className={fieldCls}>
            <option value="">Role: All</option>
            <option value="owner_admin">Owner/Admin</option>
            <option value="manager">Manager</option>
            <option value="auditor">Auditor</option>
            <option value="moderator">Moderator</option>
            <option value="viewer">Viewer</option>
          </select>
          <div className="flex gap-2">
            <input name="from" type="date" defaultValue={sp.from ?? ""} className={`${fieldCls} min-w-0 flex-1`} aria-label="Date from" />
            <input name="to" type="date" defaultValue={sp.to ?? ""} className={`${fieldCls} min-w-0 flex-1`} aria-label="Date to" />
          </div>
          <button type="submit" className="h-[32px] rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover">
            Filter
          </button>
          <a href="/audit-logs" className="flex h-[32px] items-center justify-center rounded-control border border-line px-3 text-[12px] font-semibold text-ink-600 hover:bg-line-faint">
            Clear
          </a>
        </form>

        <PaginationNav page={page} pageCount={pageCount} hrefForPage={pageHref} summary={`Page ${page} of ${pageCount} · maximum 30 entries per page`} />

        {rows.length === 0 ? (
          <EmptyState title="No audit activity found" hint="Lead, booking, financial, settings, user, import, and system actions appear here when recorded." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-[12px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-3 py-2">Exact timestamp</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Lead</th>
                  <th className="px-3 py-2">Old {"->"} New</th>
                  <th className="px-3 py-2">Source / reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const leadRef = r.metadata.lead_id ?? r.metadata.leadId ?? r.newValues.lead_id ?? r.oldValues.lead_id;
                  const reason = r.metadata.reason ?? r.newValues.reason ?? r.newValues.lost_notes ?? r.newValues.note;
                  return (
                    <tr key={r.id} className="border-b border-line-faint align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-ink-600">{formatDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2">
                        {r.isSystem ? (
                          <span className="rounded-pill bg-line-faint px-2 py-0.5 text-[10px] font-semibold text-ink-500">System</span>
                        ) : (
                          <span className="font-medium text-ink-800">{r.actorName ?? "-"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-ink-600">{r.actorRole ?? (r.isSystem ? "system" : "-")}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ink-700">{r.action}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-ink-700">{r.entityType}</div>
                        <div className="font-mono text-[10px] text-ink-400">{r.entityId}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ink-600">{String(leadRef ?? "-")}</td>
                      <td className="px-3 py-2"><ChangeCell row={r} /></td>
                      <td className="max-w-[220px] px-3 py-2 text-[11.5px] text-ink-600">
                        <div>{String(r.metadata.source ?? (r.isSystem ? "system" : "user"))}</div>
                        {reason ? <div className="mt-1 text-ink-500">{String(reason)}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <PaginationNav page={page} pageCount={pageCount} hrefForPage={pageHref} summary={`Page ${page} of ${pageCount} · maximum 30 entries per page`} />
      </div>
    </>
  );
}
