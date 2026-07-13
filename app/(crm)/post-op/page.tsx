import { Topbar } from "@/components/shell/Topbar";
import { EmptyState } from "@/components/ui/EmptyState";
import { LeadCell } from "@/components/queues/LeadCell";
import { followUpQueue } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { PaginationNav } from "@/components/ui/PaginationNav";

export const dynamic = "force-dynamic";

export default async function PostOpFollowUpPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const requestedPage = Math.max(1, Number((await searchParams).page) || 1);
  const result = await followUpQueue("post_op", requestedPage, 30);
  const items = result.items.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const ad = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bd = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return ad - bd;
  });
  const overdueCount = items.filter((i) => i.overdue).length;
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const pageHref = (page: number) => `/post-op?page=${page}`;

  return (
    <>
      <Topbar title="Post-Op Follow-Up" overdue={overdueCount} />
      <div className="flex-1 overflow-auto">
        <div className="px-[18px] py-2 text-[11.5px] text-ink-400">
          Showing {items.length} of {result.total} in post-op follow-up · {overdueCount} overdue on this page
        </div>
        <PaginationNav page={result.page} pageCount={pageCount} hrefForPage={pageHref} />

        {items.length === 0 ? (
          <EmptyState title="No post-op follow-ups scheduled" hint="Post-op stage leads appear here only when it is their primary stage." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-[18px] py-2.5">Lead</th>
                  <th className="px-3 py-2.5">Stage</th>
                  <th className="px-3 py-2.5">Reason</th>
                  <th className="px-3 py-2.5">Due</th>
                  <th className="px-3 py-2.5">Last contact</th>
                  <th className="px-3 py-2.5 pe-[18px]">Coordinator</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.lead.id} className="border-b border-line-faint hover:bg-primary-soft/30">
                    <td className="px-[18px] py-3"><LeadCell lead={i.lead} tab="Follow-Up" /></td>
                    <td className="px-3 py-3 text-ink-600">{i.stageNumber ? `#${i.stageNumber}` : "-"}</td>
                    <td className="max-w-[220px] px-3 py-3 text-ink-700">{i.reason ?? "-"}</td>
                    <td className="px-3 py-3">
                      {i.dueAt ? (
                        <span className={"inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold " + (i.overdue ? "bg-danger-bg text-danger" : "bg-line-faint text-ink-600")}>
                          {i.overdue && <span className="h-1.5 w-1.5 rounded-full bg-danger-dot" />}
                          {formatDate(i.dueAt)}
                        </span>
                      ) : (
                        <span className="text-ink-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-ink-500">{i.lastContactAt ? formatDate(i.lastContactAt) : "-"}</td>
                    <td className="px-3 py-3 pe-[18px] text-ink-600">{i.lead.assignedModerator ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <PaginationNav page={result.page} pageCount={pageCount} hrefForPage={pageHref} />
      </div>
    </>
  );
}
