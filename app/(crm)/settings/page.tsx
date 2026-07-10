import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { SchedulingSettings } from "@/components/settings/SchedulingSettings";
import { SettingsManager } from "@/components/settings/SettingsManager";
import { Card } from "@/components/ui/Card";
import { bookingSchedulingSnapshot } from "@/lib/booking/service";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { leadSourcesList } from "@/lib/data";
import {
  getAiPrompt,
  getAuditorSettings,
  listEmailRules,
  listFollowUpStages,
  listLostReasons,
  listSlaRules,
  listTags,
} from "@/lib/data/settingsData";
import type { LeadSourceInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

const SOURCE_TYPE_META: Record<string, { bg: string; fg: string }> = {
  social: { bg: "#eef2ff", fg: "#4338ca" },
  messaging: { bg: "#ecfdf3", fg: "#067647" },
  manual: { bg: "#f2f4f7", fg: "#475467" },
};

function SourceCard({ src }: { src: LeadSourceInfo }) {
  const tm = SOURCE_TYPE_META[src.sourceType] ?? { bg: "#f2f4f7", fg: "#475467" };
  return (
    <Card className="flex items-center gap-3 p-3">
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-ink-900">{src.label}</div>
        <div className="font-mono text-[10.5px] text-ink-400">{src.key}</div>
      </div>
      <span
        className="rounded-pill px-2 py-0.5 text-[10px] font-semibold capitalize"
        style={{ background: tm.bg, color: tm.fg }}
      >
        {src.sourceType}
      </span>
      <span
        className={
          "flex items-center gap-1.5 text-[11px] font-semibold " +
          (src.active ? "text-emerald-600" : "text-ink-400")
        }
      >
        <span className={"h-1.5 w-1.5 rounded-full " + (src.active ? "bg-emerald-500" : "bg-ink-300")} />
        {src.active ? "Active" : "Off"}
      </span>
    </Card>
  );
}

export default async function SettingsPage() {
  const { effective: user } = await requireSession();
  if (!can(user.role, "settings.view")) notFound();
  const canManage = can(user.role, "settings.manage");

  const [tags, lostReasons, slaRules, followUpStages, auditorSettings, aiPrompt, emailRules, sources, scheduling] =
    await Promise.all([
      listTags(),
      listLostReasons(),
      listSlaRules(),
      listFollowUpStages(),
      getAuditorSettings(),
      getAiPrompt(),
      listEmailRules(),
      leadSourcesList(),
      bookingSchedulingSnapshot(),
    ]);

  return (
    <>
      <Topbar title="CRM Settings" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <section className="mb-6">
          <h2 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-500">
            Channels & sources
          </h2>
          <p className="mb-3 text-[11.5px] text-ink-400">
            Configured intake channels. Live message ingestion is delivered by the external
            integration service.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sources.map((s) => (
              <SourceCard key={s.id} src={s} />
            ))}
          </div>
        </section>

        <SettingsManager
          canManage={canManage}
          tags={tags}
          lostReasons={lostReasons}
          slaRules={slaRules}
          followUpStages={followUpStages}
          auditorSettings={auditorSettings}
          aiPrompt={aiPrompt}
          emailRules={emailRules}
          scheduling={<SchedulingSettings snapshot={scheduling} />}
        />
      </div>
    </>
  );
}
