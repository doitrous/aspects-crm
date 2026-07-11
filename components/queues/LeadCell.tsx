import Link from "next/link";
import type { LeadSummary } from "@/lib/types";
import { PLATFORM_META } from "@/lib/badges";

/** Clickable lead identity used across queues -> opens the lead. */
export function LeadCell({ lead, tab }: { lead?: LeadSummary; tab?: string }) {
  if (!lead) {
    return <span className="text-[12px] text-ink-400">Unknown lead</span>;
  }
  const pm = PLATFORM_META[lead.platform];
  const targetTab = tab ?? lead.attentionTab;
  const href = targetTab ? `/leads/${lead.id}?tab=${encodeURIComponent(targetTab)}` : `/leads/${lead.id}`;
  return (
    <Link href={href} className="group block">
      <span data-patient-content className="font-semibold text-ink-900 group-hover:text-primary">
        {lead.name}
      </span>
      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-ink-400">
        {lead.id}
        {pm && <span style={{ color: pm.fg }}>· {pm.label}</span>}
      </span>
    </Link>
  );
}
