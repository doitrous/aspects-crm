import { Topbar } from "@/components/shell/Topbar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { crmSettings, leadSourcesList } from "@/lib/data";
import type { CrmSetting, LeadSourceInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

const SETTING_LABELS: Record<string, string> = {
  ai_extraction: "AI Extraction",
  ai_reply_assistant: "AI Reply Assistant",
  auditor_settings: "Auditor & Reporting",
  crm_roles: "Roles",
  duplicate_identifiers: "Duplicate Identifiers",
  google_sheets: "Google Sheets Mirror",
  lead_statuses: "Lead Statuses",
  urgency_options: "Urgency Options",
};

function settingLabel(key: string): string {
  return SETTING_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

const SOURCE_TYPE_META: Record<string, { bg: string; fg: string }> = {
  social: { bg: "#eef2ff", fg: "#4338ca" },
  messaging: { bg: "#ecfdf3", fg: "#067647" },
  manual: { bg: "#f2f4f7", fg: "#475467" },
};

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-pill bg-line-faint px-2 py-0.5 text-[11px] font-medium text-ink-700">
      {children}
    </span>
  );
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function primitiveText(v: string | number | boolean): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === "") return "—";
  return String(v);
}

/** Renders a jsonb setting value: scalars inline, arrays as chips, objects as a
 *  definition list, and long strings in a wrapped block. Depth-limited by design. */
function SettingValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-ink-400">—</span>;
  }
  if (isPrimitive(value)) {
    const text = primitiveText(value);
    if (typeof value === "string" && text.length > 80) {
      return (
        <pre
          dir="auto"
          className="whitespace-pre-wrap rounded-control border border-line-soft bg-line-faint/40 px-3 py-2 font-sans text-[12px] leading-relaxed text-ink-700"
        >
          {text}
        </pre>
      );
    }
    return <span className="text-[12.5px] font-medium text-ink-800">{text}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-400">empty</span>;
    if (value.every(isPrimitive)) {
      return (
        <div className="flex flex-wrap gap-1.5" dir="auto">
          {value.map((v, i) => (
            <Chip key={i}>{primitiveText(v)}</Chip>
          ))}
        </div>
      );
    }
    return (
      <span className="text-[12px] text-ink-500">{value.length} items</span>
    );
  }
  // Object → definition list of its entries.
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <dl className="space-y-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[140px_1fr] gap-2">
          <dt className="text-[11.5px] text-ink-400">{humanizeKey(k)}</dt>
          <dd>
            <SettingValue value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function SettingCard({ setting }: { setting: CrmSetting }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[13px] font-bold text-ink-900">{settingLabel(setting.key)}</h3>
        {setting.editable ? (
          <span className="rounded-pill bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-primary">
            Editable
          </span>
        ) : (
          <span className="rounded-pill bg-line-faint px-2 py-0.5 text-[10px] font-semibold text-ink-500">
            🔒 Locked
          </span>
        )}
      </div>
      {setting.description && (
        <p className="mb-2.5 text-[11.5px] text-ink-500">{setting.description}</p>
      )}
      <SettingValue value={setting.value} />
    </Card>
  );
}

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
        <span
          className={
            "h-1.5 w-1.5 rounded-full " + (src.active ? "bg-emerald-500" : "bg-ink-300")
          }
        />
        {src.active ? "Active" : "Off"}
      </span>
    </Card>
  );
}

export default async function SettingsPage() {
  const [settings, sources] = await Promise.all([crmSettings(), leadSourcesList()]);

  return (
    <>
      <Topbar title="CRM Settings" />
      <div className="flex-1 overflow-auto px-[18px] py-4">
        {/* Channels & sources — Phase 5 intake surface */}
        <section className="mb-6">
          <h2 className="mb-1 text-[12px] font-bold uppercase tracking-wide text-ink-500">
            Channels & sources
          </h2>
          <p className="mb-3 text-[11.5px] text-ink-400">
            Configured intake channels. Live message ingestion (Facebook, Instagram, WhatsApp
            webhooks) is delivered by the external integration service.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sources.map((s) => (
              <SourceCard key={s.id} src={s} />
            ))}
          </div>
        </section>

        {/* Configuration */}
        <section>
          <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wide text-ink-500">
            Configuration
          </h2>
          {settings.length === 0 ? (
            <EmptyState
              title="No settings available"
              hint="CRM settings load from the live configuration store."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {settings.map((s) => (
                <SettingCard key={s.key} setting={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
