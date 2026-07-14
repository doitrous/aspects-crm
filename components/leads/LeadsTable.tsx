"use client";

import { useRouter } from "next/navigation";
import type { Lead } from "@/lib/types";
import { STAGE_META, BOOKING_META, PLATFORM_META } from "@/lib/badges";
import { doctorName, specialtyName } from "@/lib/data/reference";
import { formatAge, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

function Indicators({ lead }: { lead: Lead }) {
  return (
    <span className="inline-flex items-center gap-1">
      {lead.unread && <span title="Unread" className="h-2 w-2 rounded-full bg-primary" />}
      {lead.escalated && <span title="Escalated" className="text-[11px] text-danger">⚑</span>}
      {lead.duplicateStatus === "suspected" && (
        <span title="Possible duplicate" className="text-[11px] text-warn">⧉</span>
      )}
    </span>
  );
}

/**
 * `now` is passed from the server page as an ISO string so this client
 * component never imports the server-only data layer just to compute SLA age.
 */
export function LeadsTable({ leads, now }: { leads: Lead[]; now: string }) {
  const router = useRouter();
  const nowDate = new Date(now);

  if (leads.length === 0) {
    return (
      <EmptyState
        title="Nothing here — inbox zero for this filter"
        hint="Try clearing filters or check another stage."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line-soft text-left text-[11px] font-semibold uppercase tracking-wide text-ink-400">
            <th className="px-[18px] py-2.5 font-semibold">Lead</th>
            <th className="px-3 py-2.5 font-semibold">Phone</th>
            <th className="px-3 py-2.5 font-semibold">Source</th>
            <th className="px-3 py-2.5 font-semibold">Service · Doctor</th>
            <th className="px-3 py-2.5 font-semibold">Status</th>
            <th className="px-3 py-2.5 font-semibold">Booking</th>
            <th className="px-3 py-2.5 font-semibold">Coordinator</th>
            <th className="px-3 py-2.5 pe-[18px] text-right font-semibold">SLA</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const pm = PLATFORM_META[lead.platform];
            const href = lead.attentionTab
              ? `/leads/${lead.id}?tab=${encodeURIComponent(lead.attentionTab)}`
              : `/leads/${lead.id}`;
            const open = () => router.push(href);
            const prefetch = () => router.prefetch(href);
            return (
              <tr
                key={lead.id}
                onClick={open}
                onMouseEnter={prefetch}
                onFocus={prefetch}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open();
                  }
                }}
                tabIndex={0}
                role="link"
                aria-label={`Open ${lead.patientName}`}
                className="group cursor-pointer border-b border-line-faint outline-none hover:bg-primary-soft/40 focus-visible:bg-primary-soft/60"
              >
                <td className="px-[18px] py-3">
                  <div className="flex items-center gap-2">
                    <Indicators lead={lead} />
                    <span data-patient-content className="font-semibold text-ink-900 group-hover:text-primary">
                      {lead.patientName}
                    </span>
                  </div>
                  <div className={"mt-0.5 font-mono text-[11px] font-bold " + (lead.mrn ? "text-ink-700" : "text-danger")}>
                    {lead.mrn ? `MRN ${lead.mrn}` : "MRN"}
                  </div>
                  {lead.attentionMessage && (
                    <div className="mt-1 max-w-[260px] truncate rounded bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800">
                      Escalation resolved: <span data-patient-content>{lead.attentionMessage}</span>
                    </div>
                  )}
                  <div className="mt-0.5 font-mono text-[10.5px] text-ink-400">
                    {lead.id}
                  </div>
                  {lead.tags.length > 0 && (
                    <div className="mt-1 flex max-w-[280px] flex-wrap gap-1">
                      {lead.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-pill border px-1.5 py-0.5 text-[10px] font-semibold"
                          style={{ borderColor: `${lead.tagColors?.[tag] ?? "#2f6fed"}55`, backgroundColor: `${lead.tagColors?.[tag] ?? "#2f6fed"}18`, color: lead.tagColors?.[tag] ?? "#2f6fed" }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td data-patient-content className="px-3 py-3 text-ink-600">{lead.phone}</td>
                <td className="px-3 py-3">
                  {(lead.sourceLabel || pm) && (
                    <span
                      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium"
                      style={{
                        background: lead.sourceLabel === "Database" ? "#f1f5f9" : pm?.bg,
                        color: lead.sourceLabel === "Database" ? "#475569" : pm?.fg,
                      }}
                    >
                      <span>{lead.sourceLabel === "Database" ? "▦" : pm?.icon}</span>
                      {lead.sourceLabel ?? pm?.label}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-ink-600">
                  <div className="text-ink-700">
                    {lead.serviceNames?.join(", ") ?? lead.serviceName ?? specialtyName(lead.specialtyId)}
                  </div>
                  <div className="text-[11px] text-ink-400">
                    {lead.doctorNames?.join(", ") ?? lead.doctorName ?? doctorName(lead.doctorId)}
                  </div>
                </td>
                <td className="px-3 py-3">
                  {lead.mergedRecord ? <span className="rounded-pill bg-violet-50 px-2 py-0.5 text-[10.5px] font-bold text-violet-700">Merged record</span> : lead.databaseOnly ? <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-600">Database only</span> : <Badge style={STAGE_META[lead.stage]} />}
                </td>
                <td className="px-3 py-3">
                  <Badge style={BOOKING_META[lead.bookingStatus]} />
                  {lead.bookingContext && lead.bookingStatus !== "none" && (
                    <div className="mt-1 max-w-[180px] text-[10.5px] leading-snug text-ink-500">{lead.bookingContext}</div>
                  )}
                </td>
                <td className="px-3 py-3 text-ink-600">
                  {lead.assignedModerator ?? "—"}
                </td>
                <td className="px-3 py-3 pe-[18px] text-right">
                  <span
                    className={
                      "font-mono text-[11px] font-semibold " +
                      (lead.overdue ? "text-danger" : "text-ink-400")
                    }
                    title={lead.lastMessageAt ? formatDate(lead.lastMessageAt) : ""}
                  >
                    {lead.lastMessageAt ? formatAge(lead.lastMessageAt, nowDate) : "—"}
                  </span>
                  {lead.overdueReason && (
                    <div className="ms-auto mt-1 max-w-[220px] rounded-md bg-danger-bg px-2 py-1 text-left text-[10px] font-semibold leading-snug text-danger">
                      {lead.overdueReason}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
