import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/Topbar";
import { SchedulingSettings } from "@/components/settings/SchedulingSettings";
import { FinancialSettingsManager } from "@/components/financial/FinancialSettingsManager";
import { SettingsManager, type IntegrationStatus, type SettingsTabKey } from "@/components/settings/SettingsManager";
import { bookingConfigured } from "@/lib/booking/client";
import { crmSchedulingSnapshot } from "@/lib/scheduling/crm";
import { emailConfigured } from "@/lib/email/resend";
import { whatsappConfigured } from "@/lib/whatsapp/config";
import { can } from "@/lib/auth/permissions";
import { requireSession } from "@/lib/data/session";
import { leadSourcesList } from "@/lib/data";
import { financialSettingsData } from "@/lib/data/financialSettings";
import {
  getAiPrompt,
  getAuditorSettings,
  listEscalationReasons,
  listFollowUpStages,
  listLostReasons,
  listSlaRules,
  listTags,
  listIngestLogs,
} from "@/lib/data/settingsData";

export const dynamic = "force-dynamic";

function integrations(): IntegrationStatus[] {
  const facebook = Boolean(process.env.FACEBOOK_APP_SECRET && process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN);
  const instagram = Boolean(process.env.INSTAGRAM_APP_SECRET && process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN);
  return [
    { key: "facebook", label: "Facebook", configured: facebook, evidence: facebook ? "Webhook secret and verify token are present." : "Missing Facebook webhook/app credentials." },
    { key: "instagram", label: "Instagram", configured: instagram, evidence: instagram ? "Webhook secret and verify token are present." : "Missing Instagram webhook/app credentials." },
    { key: "whatsapp", label: "WhatsApp", configured: whatsappConfigured(), evidence: whatsappConfigured() ? "WhatsApp access token plus phone/business identifier are present." : "Missing WhatsApp Cloud API credentials." },
    { key: "booking", label: "Booking system", configured: bookingConfigured(), evidence: bookingConfigured() ? "Booking Supabase URL and service role key are present." : "Missing booking Supabase server credentials." },
    { key: "resend", label: "Resend", configured: emailConfigured(), evidence: emailConfigured() ? "Resend API key is present." : "Email sends will be logged as skipped." },
  ];
}

const SETTINGS_SECTIONS = new Set<SettingsTabKey>([
  "account", "bulkImport", "tags", "lost", "escalation", "followup", "rules", "sources",
  "duplicates", "reporting", "ai", "integrations", "ingestion", "users", "scheduling", "financial", "email",
]);

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string; financeTab?: string }> }) {
  const { effective: user } = await requireSession();
  if (!can(user.role, "settings.view")) notFound();
  const canManage = can(user.role, "settings.manage");
  const params = await searchParams;
  const initialTab = SETTINGS_SECTIONS.has(params.section as SettingsTabKey) ? params.section as SettingsTabKey : "scheduling";

  const [tags, lostReasons, escalationReasons, slaRules, followUpStages, auditorSettings, aiPrompt, sources, scheduling, financial, ingestLogs] =
    await Promise.all([
      listTags(),
      listLostReasons(),
      listEscalationReasons(),
      listSlaRules(),
      listFollowUpStages(),
      getAuditorSettings(),
      getAiPrompt(),
      leadSourcesList(),
      can(user.role, "scheduling.view") ? crmSchedulingSnapshot() : Promise.resolve(null),
      financialSettingsData(),
      listIngestLogs(),
    ]);

  return (
    <>
      <Topbar title="CRM Settings" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        <SettingsManager
          initialTab={initialTab}
          canManage={canManage}
          tags={tags}
          lostReasons={lostReasons}
          escalationReasons={escalationReasons}
          slaRules={slaRules}
          followUpStages={followUpStages}
          auditorSettings={auditorSettings}
          aiPrompt={aiPrompt}
          sources={sources}
          integrations={integrations()}
          scheduling={scheduling ? <SchedulingSettings snapshot={scheduling} /> : <div className="rounded-xl border border-line p-5 text-[12px] text-ink-500">You do not have permission to view CRM scheduling.</div>}
          financial={<FinancialSettingsManager data={financial} initialTab={params.financeTab} />}
          ingestLogs={ingestLogs}
        />
      </div>
    </>
  );
}
