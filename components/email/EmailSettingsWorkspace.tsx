import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ManualEmailForm } from "@/components/email/ManualEmailForm";
import { EmailAutomationManager } from "@/components/email/EmailAutomationManager";
import type { EmailLogRow } from "@/lib/data/emailData";
import type { EmailRuleSetting } from "@/lib/data/settingsData";
import { formatDateTime } from "@/lib/format";

const statusClass: Record<string,string> = { sent:"bg-emerald-100 text-emerald-700", queued:"bg-blue-100 text-blue-700", failed:"bg-red-100 text-red-700", skipped:"bg-line-faint text-ink-500" };

export function EmailSettingsWorkspace({ rules, rows, canManage, configured }: { rules: EmailRuleSetting[]; rows: EmailLogRow[]; canManage: boolean; configured: boolean }) {
  return <div className="space-y-5"><div className="section-hero rounded-xl p-5"><div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Settings / Email</div><h1 className="mt-1 text-[22px] font-black text-ink-950">Email configuration, automation and delivery</h1><p className="section-hero-muted mt-1 max-w-3xl text-[12px]">Provider secrets stay on the server. This section consolidates templates, event rules, manual testing, delivery outcomes and failure evidence.</p></div>
  {!configured&&<div className="rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">Resend is not configured. Generated emails are recorded as skipped until the server key is configured.</div>}
  <EmailAutomationManager rules={rules} canManage={canManage}/>{canManage&&<ManualEmailForm/>}
  <section><div className="mb-3"><h2 className="text-[18px] font-black text-ink-950">Delivery history</h2><p className="text-[12px] text-ink-500">Real provider outcomes, recipients, trigger evidence and errors.</p></div>{rows.length===0?<EmptyState title="No emails yet" hint="Generated messages will appear here."/>:<Card className="overflow-x-auto"><table className="w-full min-w-[840px] text-[12px]"><thead><tr className="border-b border-line-soft text-left text-[10px] uppercase tracking-wide text-ink-400"><th className="px-3 py-2">When</th><th className="px-3 py-2">Recipients</th><th className="px-3 py-2">Subject</th><th className="px-3 py-2">Rule / trigger</th><th className="px-3 py-2">Lead</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Provider / error</th></tr></thead><tbody>{rows.map((row)=><tr key={row.id} className="border-b border-line-faint align-top"><td className="whitespace-nowrap px-3 py-2">{formatDateTime(row.createdAt)}</td><td className="px-3 py-2">{row.recipients.join(", ")||"—"}</td><td className="px-3 py-2">{row.subject||"—"}</td><td className="px-3 py-2"><div>{row.ruleKey||"—"}</div><small>{row.trigger}</small></td><td className="px-3 py-2">{row.leadHumanId?<Link href={`/leads/${row.leadHumanId}`} className="font-mono text-primary">{row.leadHumanId}</Link>:"—"}</td><td className="px-3 py-2"><span className={`rounded-pill px-2 py-0.5 text-[10px] font-bold ${statusClass[row.status]||statusClass.queued}`}>{row.status}</span></td><td className="px-3 py-2 text-[11px] text-ink-500">{row.providerMessageId}<div className="text-danger">{row.error}</div></td></tr>)}</tbody></table></Card>}</section></div>;
}
