import { Topbar } from "@/components/shell/Topbar";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { EscalationResolutionControls } from "@/components/queues/EscalationResolutionControls";
import { LeadCell } from "@/components/queues/LeadCell";
import { escalationQueue } from "@/lib/data";
import { SEVERITY_META } from "@/lib/badges";
import { formatDate } from "@/lib/format";
import type { EscalationStatus } from "@/lib/types";
import { resolveEscalationAction, returnEscalationAction } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_META: Record<EscalationStatus, { label: string; bg: string; fg: string }> = {
  open: { label: "Open", bg: "#fef3f2", fg: "#b42318" },
  assigned: { label: "In review", bg: "#fffaeb", fg: "#b54708" },
  resolved: { label: "Resolved", bg: "#ecfdf3", fg: "#067647" },
};

const STATUS_RANK: Record<EscalationStatus, number> = { open: 0, assigned: 1, resolved: 2 };

export default async function EscalationsPage() {
  const items = (await escalationQueue()).sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const openCount = items.filter((e) => e.status !== "resolved").length;

  return (
    <>
      <Topbar title="Escalations" />
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          {openCount} open · {items.length} total
        </div>

        {items.length === 0 ? (
          <EmptyState
            title="No escalations — the queue is clear"
            hint="Moderators can raise an escalation from any lead's Escalations tab."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-[18px] py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Reason</th>
                  <th className="px-3 py-2.5">Severity</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Raised by</th>
                  <th className="px-3 py-2.5">Assigned</th>
                  <th className="px-3 py-2.5">Raised</th>
                  <th className="px-3 py-2.5 pe-[18px] text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => {
                  const sm = STATUS_META[e.status];
                  return (
                    <tr
                      key={e.id}
                      className={
                        "border-b border-line-faint hover:bg-primary-soft/30 " +
                        (e.status === "resolved" ? "opacity-60" : "")
                      }
                    >
                      <td className="px-[18px] py-3">
                        <LeadCell lead={e.lead} tab="Log" />
                      </td>
                      <td className="max-w-[260px] px-3 py-3 text-ink-700">{e.reason}</td>
                      <td className="px-3 py-3">
                        <Badge style={SEVERITY_META[e.severity]} />
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className="inline-flex rounded-pill px-2.5 py-1 text-[11px] font-semibold"
                          style={{ background: sm.bg, color: sm.fg }}
                        >
                          {sm.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-ink-600">{e.raisedBy}</td>
                      <td className="px-3 py-3 text-ink-600">{e.assignedTo ?? "—"}</td>
                      <td className="px-3 py-3 text-ink-500">{formatDate(e.createdAt)}</td>
                      <td className="px-3 py-3 pe-[18px] text-right">
                        {e.status === "resolved" ? (
                          <span className="text-[11px] text-ink-400">
                            {e.resolvedBy ? `by ${e.resolvedBy}` : "—"}
                          </span>
                        ) : (
                          <EscalationResolutionControls
                            onReturn={returnEscalationAction.bind(null, e.id)}
                            onResolve={resolveEscalationAction.bind(null, e.id)}
                          />
                        )}
                      </td>
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
