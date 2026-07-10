import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { listActivity, type ActivityRow } from "@/lib/audit/log";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Compact one-line render of the changed fields (old → new). */
function ChangeCell({ row }: { row: ActivityRow }) {
  const keys = [...new Set([...Object.keys(row.oldValues), ...Object.keys(row.newValues)])]
    .filter((k) => k !== "source")
    .slice(0, 6);
  if (keys.length === 0) return <span className="text-ink-400">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {keys.map((k) => {
        const oldV = row.oldValues[k];
        const newV = row.newValues[k];
        const fmt = (v: unknown) =>
          v === undefined || v === null || v === "" ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return (
          <div key={k} className="text-[11px]">
            <span className="font-mono text-ink-500">{k}: </span>
            {k in row.oldValues && (
              <span className="text-ink-400 line-through">{fmt(oldV)}</span>
            )}
            {k in row.oldValues && k in row.newValues && <span className="text-ink-400"> → </span>}
            {k in row.newValues && <span className="font-medium text-ink-800">{fmt(newV)}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Admin/Auditor global activity log (spec §H, §35). Reads the unified
 * `audit_logs` sink through `listActivity`, so it shows every recorded change —
 * leads, financials, settings, reports, emails — with actor, timestamp and the
 * old → new diff, distinguishing human edits from system actions.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; action?: string }>;
}) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "audit.view")) notFound();

  const sp = await searchParams;
  const rows = await listActivity({
    entityType: sp.entity?.trim() || undefined,
    action: sp.action?.trim() || undefined,
    limit: 300,
  });

  const fieldCls =
    "h-[32px] rounded-control border border-line px-2.5 text-[12px] text-ink-800 outline-none focus:border-primary bg-panel";

  return (
    <>
      <Topbar title="Activity Log" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <form method="get" className="mb-3 flex flex-wrap gap-2">
          <input name="entity" defaultValue={sp.entity ?? ""} placeholder="Entity type (e.g. tag, audit_report, email_rule)" className={`${fieldCls} min-w-[240px] flex-1`} />
          <input name="action" defaultValue={sp.action ?? ""} placeholder="Action (e.g. settings.tag_updated)" className={`${fieldCls} min-w-[200px]`} />
          <button type="submit" className="h-[32px] rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover">
            Filter
          </button>
          {(sp.entity || sp.action) && (
            <a href="/activity" className="flex h-[32px] items-center rounded-control border border-line px-3 text-[12px] font-semibold text-ink-600 hover:bg-line-faint">
              Clear
            </a>
          )}
        </form>

        {rows.length === 0 ? (
          <EmptyState title="No activity recorded yet" hint="Changes across the CRM appear here with full attribution." />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Entity</th>
                  <th className="px-3 py-2">Change (old → new)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line-faint align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-600">{formatDateTime(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      {r.isSystem ? (
                        <span className="rounded-pill bg-line-faint px-2 py-0.5 text-[10px] font-semibold text-ink-500">System</span>
                      ) : (
                        <span className="font-medium text-ink-800">{r.actorName ?? "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-ink-700">{r.action}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium text-ink-700">{r.entityType}</div>
                      <div className="font-mono text-[10px] text-ink-400">{r.entityId}</div>
                    </td>
                    <td className="px-3 py-2">
                      <ChangeCell row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
