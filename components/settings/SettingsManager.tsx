"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import {
  type SettingsActionState,
  upsertTagAction,
  upsertLostReasonAction,
  upsertEscalationReasonAction,
  updateSlaRuleAction,
  upsertFollowUpStageAction,
  deleteFollowUpStageAction,
  updateAuditorTargetsAction,
  updateAiPromptAction,
  backfillDuplicatesAction,
} from "@/app/(crm)/settings/actions";
import { Card } from "@/components/ui/Card";
import type {
  TagSetting,
  LostReasonSetting,
  EscalationReasonSetting,
  SlaRuleSetting,
  FollowUpStageSetting,
  AuditorSettingsRow,
  AiPromptSetting,
  EmailRuleSetting,
  IngestLogSetting,
} from "@/lib/data/settingsData";
import type { LeadSourceInfo } from "@/lib/types";
import { formatDateTime } from "@/lib/format";
import { EmailAutomationManager } from "@/components/email/EmailAutomationManager";

const PatientBulkImport = dynamic(
  () => import("@/components/leads/PatientBulkImport").then((module) => module.PatientBulkImport),
  {
    ssr: false,
    loading: () => <div className="rounded-xl border border-line-soft bg-panel p-5 text-[12px] text-ink-500">Loading importer…</div>,
  },
);

const SETTINGS_IDLE: SettingsActionState = { ok: false };
const SETTINGS_PAGE_SIZE = 30;

const field =
  "min-w-0 rounded-control border border-line-soft bg-white px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary disabled:opacity-60";
const label = "flex flex-col gap-1 text-[11px] font-semibold text-ink-500";

function Feedback({ state }: { state: SettingsActionState }) {
  if (state.error) return <span className="text-[11px] font-semibold text-red-600">{state.error}</span>;
  if (state.ok && state.message)
    return <span className="text-[11px] font-semibold text-emerald-600">{state.message}</span>;
  return null;
}

function SaveButton({ pending, children = "Save" }: { pending: boolean; children?: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-8 rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "Saving…" : children}
    </button>
  );
}

function DuplicateBackfill({ canManage }: { canManage: boolean }) {
  const [state, action, pending] = useActionState(backfillDuplicatesAction, SETTINGS_IDLE);
  return <form action={action} className="mt-4 rounded-control border border-primary/20 bg-primary-soft/30 p-3"><input type="hidden" name="cursor" value={state.cursor ?? ""}/><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[12px] font-black text-ink-900">Backfill existing database records</div><p className="mt-1 text-[11px] text-ink-500">Runs the same live detector in idempotent batches of 500; it never merges patients automatically.</p></div>{canManage && <SaveButton pending={pending}>{state.cursor ? "Run next batch" : state.complete ? "Run safety check again" : "Start duplicate backfill"}</SaveButton>}</div><Feedback state={state}/></form>;
}

function PagedItems<T>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / SETTINGS_PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const visible = items.slice((safePage - 1) * SETTINGS_PAGE_SIZE, safePage * SETTINGS_PAGE_SIZE);
  const controls = pages > 1 && <div className="my-3 flex items-center justify-end gap-2 border-y border-line-soft bg-toolbar/60 py-2.5 text-[11.5px]"><span className="me-auto font-medium text-ink-500">Page {safePage} of {pages}</span><button disabled={safePage === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-control border border-primary/30 bg-panel px-3 py-2 font-bold text-primary shadow-sm hover:bg-primary-soft disabled:opacity-40">Previous</button><button disabled={safePage === pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} className="rounded-control border border-primary bg-primary px-3 py-2 font-bold text-white shadow-sm hover:bg-primary-hover disabled:opacity-40">Next</button></div>;
  return <>{controls}{visible.map(render)}{controls}</>;
}

/* ── Tags ─────────────────────────────────────────────────────── */
function TagForm({ tag, canManage }: { tag?: TagSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(upsertTagAction, SETTINGS_IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-line-faint py-2.5 last:border-0">
      {tag && <input type="hidden" name="id" value={tag.id} />}
      <label className={label}>
        Name
        <input name="name" defaultValue={tag?.name ?? ""} required disabled={!canManage} className={`${field} min-w-[160px]`} />
      </label>
      <label className={label}>
        Color
        <input type="color" name="color" defaultValue={tag?.color ?? "#4338ca"} disabled={!canManage} className="h-8 w-12 rounded-control border border-line-soft" />
      </label>
      <label className={label}>
        Order
        <input type="number" name="displayOrder" defaultValue={tag?.displayOrder ?? 0} disabled={!canManage} className={`${field} w-20`} />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
        <input type="checkbox" name="isActive" defaultChecked={tag?.isActive ?? true} disabled={!canManage} /> Active
      </label>
      {canManage && <SaveButton pending={pending}>{tag ? "Save" : "Add tag"}</SaveButton>}
      <Feedback state={state} />
    </form>
  );
}

/* ── Lost reasons ─────────────────────────────────────────────── */
function LostReasonForm({ reason, canManage }: { reason?: LostReasonSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(upsertLostReasonAction, SETTINGS_IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-line-faint py-2.5 last:border-0">
      {reason && <input type="hidden" name="id" value={reason.id} />}
      <label className={label}>
        Reason
        <input name="label" defaultValue={reason?.label ?? ""} required disabled={!canManage} className={`${field} min-w-[220px]`} />
      </label>
      <label className={label}>
        Order
        <input type="number" name="displayOrder" defaultValue={reason?.displayOrder ?? 0} disabled={!canManage} className={`${field} w-20`} />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
        <input type="checkbox" name="isActive" defaultChecked={reason?.isActive ?? true} disabled={!canManage} /> Active
      </label>
      {canManage && <SaveButton pending={pending}>{reason ? "Save" : "Add reason"}</SaveButton>}
      <Feedback state={state} />
    </form>
  );
}

/* ── Escalation reasons ──────────────────────────────────────── */
function EscalationReasonForm({ reason, canManage }: { reason?: EscalationReasonSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(upsertEscalationReasonAction, SETTINGS_IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-line-faint py-2.5 last:border-0">
      {reason && <input type="hidden" name="id" value={reason.id} />}
      <label className={label}>
        Reason
        <input name="label" defaultValue={reason?.label ?? ""} required disabled={!canManage} className={`${field} min-w-[220px]`} />
      </label>
      <label className={label}>
        Severity
        <select name="severity" defaultValue={reason?.severity ?? "medium"} disabled={!canManage} className={field}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select>
      </label>
      <label className={label}>
        Order
        <input type="number" name="displayOrder" defaultValue={reason?.displayOrder ?? 0} disabled={!canManage} className={`${field} w-20`} />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
        <input type="checkbox" name="isActive" defaultChecked={reason?.isActive ?? true} disabled={!canManage} /> Active
      </label>
      {canManage && <SaveButton pending={pending}>{reason ? "Save" : "Add reason"}</SaveButton>}
      <Feedback state={state} />
    </form>
  );
}

/* ── SLA rules ────────────────────────────────────────────────── */
function SlaForm({ rule, canManage }: { rule: SlaRuleSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(updateSlaRuleAction, SETTINGS_IDLE);
  return (
    <form action={action} className={"rounded-xl border p-4 " + (rule.isActive ? "border-line bg-panel" : "border-line-soft bg-slate-50 opacity-75")}>
      <input type="hidden" name="id" value={rule.id} />
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div><div className="text-[14px] font-black text-ink-900">{rule.stageLabel}</div><div className="mt-0.5 text-[10.5px] text-ink-400">Applied whenever an unread message arrives while a lead is in this stage.</div></div>
        <span className={"rounded-full px-2.5 py-1 text-[10px] font-black " + (rule.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{rule.isActive ? "ENFORCED" : "OFF"}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
      <label className={label}>
        Reply deadline (min)
        <input type="number" name="replyDeadlineMinutes" min={1} defaultValue={rule.replyDeadlineMinutes} disabled={!canManage} className={field} />
      </label>
      <label className={label}>
        Warn at (min)
        <input type="number" name="warningThresholdMinutes" min={0} defaultValue={rule.warningThresholdMinutes} disabled={!canManage} className={field} />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
        <input type="checkbox" name="isActive" defaultChecked={rule.isActive} disabled={!canManage} /> Active
      </label>
      {canManage && <SaveButton pending={pending} />}
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[10.5px] leading-relaxed text-ink-600">
        Result: after {rule.replyDeadlineMinutes} minutes, the lead row turns red and shows the exact missed reply deadline. Changing this rule recalculates every currently unread {rule.stageLabel.toLowerCase()} lead.
      </div>
      <Feedback state={state} />
    </form>
  );
}

/* ── Follow-up workflow stages ────────────────────────────────── */
function FollowUpStageForm({
  stage,
  canManage,
  tags,
  workflowType,
}: {
  stage?: FollowUpStageSetting;
  canManage: boolean;
  tags: TagSetting[];
  workflowType?: "regular" | "postop";
}) {
  const [state, action, pending] = useActionState(upsertFollowUpStageAction, SETTINGS_IDLE);
  const [del, delAction, delPending] = useActionState(deleteFollowUpStageAction, SETTINGS_IDLE);
  return (
    <div className="relative rounded-xl border border-line bg-white p-4 shadow-sm">
      <span className="absolute -start-3 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[10px] font-black text-white">{stage?.stageOrder ?? "+"}</span>
      <form action={action} className="grid gap-3 ps-2 sm:grid-cols-2 xl:grid-cols-4">
        {stage && <input type="hidden" name="id" value={stage.id} />}
        <input type="hidden" name="workflowType" value={stage?.workflowType ?? workflowType ?? "regular"} />
        <label className={label}>
          Step name
          <input name="name" defaultValue={stage?.name ?? ""} required disabled={!canManage} className={`${field} min-w-[150px]`} />
        </label>
        <label className={`${label} sm:col-span-2 xl:col-span-4`}>
          Moderator instruction
          <textarea name="moderatorInstruction" defaultValue={stage?.moderatorInstruction ?? ""} disabled={!canManage} rows={2} placeholder="What should the moderator do or ask during this step?" className={field} />
        </label>
        <label className={label}>
          Order
          <input type="number" name="stageOrder" defaultValue={stage?.stageOrder ?? 0} disabled={!canManage} className={`${field} w-16`} />
        </label>
        <label className={label}>
          Due after
          <input type="number" name="dueAfterAmount" min={0} defaultValue={stage?.dueAfterAmount ?? 1} disabled={!canManage} className={`${field} w-16`} />
        </label>
        <label className={label}>
          Unit
          <select name="dueAfterUnit" defaultValue={stage?.dueAfterUnit ?? "days"} disabled={!canManage} className={field}>
            <option value="hours">hours</option>
            <option value="days">days</option>
            <option value="weeks">weeks</option>
          </select>
        </label>
        <label className={label}>
          Anchor
          <select name="anchor" defaultValue={stage?.anchor ?? "stage_entry"} disabled={!canManage} className={field}>
            <option value="stage_entry">Stage entry</option>
            <option value="plan_start">Plan start</option>
            <option value="previous_step">Previous step</option>
            <option value="booking_date">Booking date</option>
            <option value="procedure_date">Procedure date</option>
          </select>
        </label>
        <label className={label}>
          Status
          <select name="applicableStatus" defaultValue={stage?.applicableStatus ?? ""} disabled={!canManage} className={field}>
            <option value="">Any</option>
            <option value="follow_up">Follow-Up</option>
            <option value="post_op">Post-Op Follow-Up</option>
            <option value="qualified">Qualified</option>
            <option value="booked">Booked</option>
          </select>
        </label>
        <label className={label}>
          Tag
          <select name="applicableTagId" defaultValue={stage?.applicableTagId ?? ""} disabled={!canManage} className={field}>
            <option value="">Any</option>
            {tags.filter((tag) => tag.isActive).map((tag) => (
              <option key={tag.id} value={tag.id}>{tag.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
          <input type="checkbox" name="isActive" defaultChecked={stage?.isActive ?? true} disabled={!canManage} /> Active
        </label>
        <div className="flex items-center gap-2 sm:col-span-2 xl:col-span-4">{canManage && <SaveButton pending={pending}>{stage ? "Save step" : "Add step"}</SaveButton>}<Feedback state={state} /></div>
      </form>
      {stage && canManage && (
        <form action={delAction} className="mt-1">
          <input type="hidden" name="id" value={stage.id} />
          <button type="submit" disabled={delPending} className="text-[11px] font-semibold text-red-600 hover:underline disabled:opacity-60">
            {delPending ? "Removing…" : "Remove step"}
          </button>
          <Feedback state={del} />
        </form>
      )}
    </div>
  );
}

/* ── Targets ──────────────────────────────────────────────────── */
function TargetsForm({ settings, canManage }: { settings: AuditorSettingsRow; canManage: boolean }) {
  const [state, action, pending] = useActionState(updateAuditorTargetsAction, SETTINGS_IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className={label}>
        Target CPL (EGP)
        <input type="number" name="targetCplEgp" min={0} defaultValue={settings.targetCplEgp} disabled={!canManage} className={`${field} w-32`} />
      </label>
      <label className={label}>
        Response threshold (min)
        <input type="number" name="responseTimeThresholdMinutes" min={0} defaultValue={settings.responseTimeThresholdMinutes} disabled={!canManage} className={`${field} w-32`} />
      </label>
      <label className={label}>
        Follow-up target (%)
        <input type="number" name="followupCompletionTarget" min={0} max={100} defaultValue={settings.followupCompletionTarget} disabled={!canManage} className={`${field} w-28`} />
      </label>
      {canManage && <SaveButton pending={pending} />}
      <Feedback state={state} />
    </form>
  );
}

/* ── AI prompt ────────────────────────────────────────────────── */
function AiPromptForm({ prompt, canManage }: { prompt: AiPromptSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(updateAiPromptAction, SETTINGS_IDLE);
  return (
    <form action={action} className="flex flex-col gap-3">
      {prompt.id && <input type="hidden" name="id" value={prompt.id} />}
      <input type="hidden" name="promptKey" value={prompt.promptKey} />
      <label className={label}>
        Title
        <input name="title" defaultValue={prompt.title} disabled={!canManage} className={`${field} max-w-md`} />
      </label>
      <label className={label}>
        System prompt (used for CRM suggested replies)
        <textarea name="systemPrompt" defaultValue={prompt.systemPrompt} required disabled={!canManage} rows={8} dir="auto" className={`${field} font-mono`} />
      </label>
      <label className={label}>
        Reply rules (optional)
        <textarea name="replyRules" defaultValue={prompt.replyRules ?? ""} disabled={!canManage} rows={4} dir="auto" className={field} />
      </label>
      {canManage && (
        <div className="flex items-center gap-3">
          <SaveButton pending={pending}>Save prompt</SaveButton>
          <Feedback state={state} />
        </div>
      )}
    </form>
  );
}

const SOURCE_TYPE_META: Record<string, { bg: string; fg: string }> = {
  social: { bg: "#eef2ff", fg: "#4338ca" },
  messaging: { bg: "#ecfdf3", fg: "#067647" },
  manual: { bg: "#f2f4f7", fg: "#475467" },
};

function SourceCard({ src }: { src: LeadSourceInfo }) {
  const tm = SOURCE_TYPE_META[src.sourceType] ?? { bg: "#f2f4f7", fg: "#475467" };
  return (
    <div className="flex items-center gap-3 rounded-control border border-line-soft p-3">
      <div className="flex-1">
        <div className="text-[13px] font-semibold text-ink-900">{src.label}</div>
        <div className="font-mono text-[10.5px] text-ink-400">{src.key}</div>
      </div>
      <span className="rounded-pill px-2 py-0.5 text-[10px] font-semibold capitalize" style={{ background: tm.bg, color: tm.fg }}>
        {src.sourceType}
      </span>
      <span className={"flex items-center gap-1.5 text-[11px] font-semibold " + (src.active ? "text-emerald-600" : "text-ink-400")}>
        <span className={"h-1.5 w-1.5 rounded-full " + (src.active ? "bg-emerald-500" : "bg-ink-300")} />
        {src.active ? "Active" : "Off"}
      </span>
    </div>
  );
}

function InfoGrid({ rows }: { rows: Array<{ label: string; value: ReactNode; hint?: string }> }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="rounded-control border border-line-soft p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{r.label}</div>
          <div className="mt-1 text-[13px] font-semibold text-ink-900">{r.value}</div>
          {r.hint && <div className="mt-1 text-[11.5px] text-ink-500">{r.hint}</div>}
        </div>
      ))}
    </div>
  );
}

function ConnectedBadge({ ok }: { ok: boolean }) {
  return (
    <span className={"rounded-pill px-2.5 py-1 text-[11px] font-semibold " + (ok ? "bg-emerald-100 text-emerald-700" : "bg-line-faint text-ink-500")}>
      {ok ? "Configured" : "Not configured"}
    </span>
  );
}

/* ── Shell ────────────────────────────────────────────────────── */
export type SettingsTabKey =
  | "general"
  | "bulkImport"
  | "leadFields"
  | "tags"
  | "lost"
  | "escalation"
  | "followup"
  | "rules"
  | "sources"
  | "idRules"
  | "duplicates"
  | "reporting"
  | "ai"
  | "integrations"
  | "scheduling"
  | "financial"
  | "email"
  | "ingestion"
  | "users";

const TABS: Array<{ key: SettingsTabKey; label: string }> = [
  { key: "general", label: "General CRM Settings" },
  { key: "bulkImport", label: "Bulk Import" },
  { key: "leadFields", label: "Lead Fields" },
  { key: "tags", label: "Tags & Colors" },
  { key: "lost", label: "Lost Reasons" },
  { key: "escalation", label: "Escalation Reasons" },
  { key: "followup", label: "Follow-Up Stages" },
  { key: "rules", label: "Rules" },
  { key: "sources", label: "Sources & Campaigns" },
  { key: "idRules", label: "ID / MRN Rules" },
  { key: "duplicates", label: "Duplicate Rules" },
  { key: "reporting", label: "Reporting Settings" },
  { key: "ai", label: "AI Reply Assistant" },
  { key: "integrations", label: "Integrations" },
  { key: "ingestion", label: "Ingestion Log" },
  { key: "users", label: "Users & Roles" },
  { key: "scheduling", label: "Scheduling" },
  { key: "financial", label: "Financial Settings" },
  { key: "email", label: "Email Rules" },
];

export interface IntegrationStatus {
  key: string;
  label: string;
  configured: boolean;
  evidence: string;
}

export function SettingsManager({
  initialTab = "general",
  canManage,
  tags,
  lostReasons,
  escalationReasons,
  slaRules,
  followUpStages,
  auditorSettings,
  aiPrompt,
  emailRules,
  sources,
  integrations,
  scheduling,
  financial,
  ingestLogs,
}: {
  initialTab?: SettingsTabKey;
  canManage: boolean;
  tags: TagSetting[];
  lostReasons: LostReasonSetting[];
  escalationReasons: EscalationReasonSetting[];
  slaRules: SlaRuleSetting[];
  followUpStages: FollowUpStageSetting[];
  auditorSettings: AuditorSettingsRow;
  aiPrompt: AiPromptSetting;
  emailRules: EmailRuleSetting[];
  sources: LeadSourceInfo[];
  integrations: IntegrationStatus[];
  scheduling: ReactNode;
  financial: ReactNode;
  ingestLogs: IngestLogSetting[];
}) {
  const [tab, setTab] = useState<SettingsTabKey>(initialTab);

  function selectTab(next: SettingsTabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "general") url.searchParams.delete("section");
    else url.searchParams.set("section", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      <aside className="flex flex-row flex-nowrap gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={
              "shrink-0 rounded-control px-3 py-2 text-left text-[12.5px] font-semibold transition-colors lg:shrink " +
              (tab === t.key ? "bg-primary-soft text-primary" : "text-ink-600 hover:bg-line-faint/60")
            }
          >
            {t.label}
          </button>
        ))}
      </aside>

      <div className="min-w-0">
        {!canManage && (
          <p className="mb-3 rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
            You can view these settings, but only an admin or auditor may change them. Changes are enforced server-side.
          </p>
        )}

        {tab === "general" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">General CRM Settings</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">Operational settings that are actually consumed by the current CRM runtime.</p>
            <InfoGrid
              rows={[
                { label: "Lead list page size", value: "30 leads", hint: "Used by server-side list pagination." },
                { label: "Canonical lead drawer", value: "Single drawer", hint: "Overview, Messenger, WhatsApp, Comments, Notes, Follow-Up, Booking, Payments / Financials, Log." },
                { label: "Primary stages", value: "Exclusive", hint: "New, Qualified/Booked, Follow-Up, Post-Op Follow-Up, Lost." },
                { label: "Booking source", value: "Booking platform database", hint: "Public booking, CRM Booking, Website Reservations, Calendar, and Scheduling read the same source." },
              ]}
            />
          </Card>
        )}

        {tab === "bulkImport" && (
          <div>
            <p className="mb-4 max-w-3xl text-[12px] text-ink-500">
              Upload patient spreadsheets into the CRM Database. Files are reviewed and mapped before any patient records are imported.
            </p>
            <PatientBulkImport />
          </div>
        )}

        {tab === "leadFields" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Lead Fields</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">
              These are the current persisted lead fields. Arbitrary schema-changing fields are intentionally not exposed from the browser.
            </p>
            <InfoGrid
              rows={[
                { label: "Identity", value: "Lead ID, MRN, name, phone", hint: "Lead ID generation uses the database function crm_generate_lead_id." },
                { label: "Attribution", value: "Platform, source, campaign-ready metadata", hint: "Source filters use lead_sources; platform remains the communication channel." },
                { label: "Workflow", value: "Status, tags, unread, SLA, escalations", hint: "Status is a single primary stage; follow-up tasks are separate records." },
                { label: "Clinical notes", value: "Client Notes, Medical History, Notes", hint: "Saved directly on the lead and audited." },
              ]}
            />
          </Card>
        )}

        {tab === "tags" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Tags & Colors</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">Moderators may only apply tags from this list — they cannot invent new ones.</p>
            <PagedItems items={tags} render={(t) => <TagForm key={t.id} tag={t} canManage={canManage} />} />
            {canManage && <div className="mt-2"><TagForm canManage={canManage} /></div>}
          </Card>
        )}

        {tab === "lost" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Lost Reasons</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">The controlled list a moderator must choose from when marking a lead Lost.</p>
            <PagedItems items={lostReasons} render={(r) => <LostReasonForm key={r.id} reason={r} canManage={canManage} />} />
            {canManage && <div className="mt-2"><LostReasonForm canManage={canManage} /></div>}
          </Card>
        )}

        {tab === "escalation" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Escalation Reasons</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">Controlled reasons and default severity for escalation workflows. Moderator details are still required when escalating.</p>
            {escalationReasons.length === 0 && (
              <p className="mb-2 rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                Run migration 0013_crm_escalation_reasons.sql to enable persisted escalation reason management.
              </p>
            )}
            <PagedItems items={escalationReasons} render={(r) => <EscalationReasonForm key={r.id} reason={r} canManage={canManage} />} />
            {canManage && <div className="mt-2"><EscalationReasonForm canManage={canManage} /></div>}
          </Card>
        )}

        {tab === "rules" && (
          <Card className="p-4 sm:p-5">
            <div className="mb-4 border-b border-line pb-4"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Operational enforcement</div><h3 className="mt-1 text-[20px] font-black text-ink-900">Reply deadline rules</h3><p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-500">Each active rule starts a timer on the first unread patient message. When the deadline passes, the lead becomes overdue everywhere and the row explains why.</p></div>
            {slaRules.length === 0 && <p className="text-[12px] text-ink-400">No stage reply rules configured.</p>}
            <div className="grid gap-3 lg:grid-cols-2">{slaRules.map((r) => <SlaForm key={r.id} rule={r} canManage={canManage} />)}</div>
          </Card>
        )}

        {tab === "followup" && (
          <div className="space-y-5">
            <div className="section-hero rounded-xl p-5"><div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Workflow designer</div><h3 className="mt-1 text-[22px] font-black text-ink-950">Follow-up journeys</h3><p className="section-hero-muted mt-1 max-w-2xl text-[12px]">Regular leads and post-op patients have separate journeys. Each step defines when it becomes due, what activates it, and exactly what the moderator should do.</p></div>
            {(["regular", "postop"] as const).map((type) => {
              const stages = followUpStages.filter((stage) => stage.workflowType === type).sort((a, b) => a.stageOrder - b.stageOrder);
              return <Card key={type} className="p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3"><div><div className="text-[16px] font-black text-ink-900">{type === "regular" ? "Regular lead flow" : "Post-op patient flow"}</div><p className="mt-1 text-[11px] text-ink-500">{type === "regular" ? "Starts when a lead enters Follow-Up." : "Starts from the procedure date or Post-Op stage."}</p></div><span className="rounded-full bg-primary-soft px-3 py-1 text-[10.5px] font-black text-primary">{stages.length} steps</span></div><div className="ms-3 space-y-3 border-s-2 border-line-soft ps-5">{stages.map((stage) => <FollowUpStageForm key={stage.id} stage={stage} canManage={canManage} tags={tags} workflowType={type} />)}{canManage && <FollowUpStageForm canManage={canManage} tags={tags} workflowType={type} />}</div></Card>;
            })}
          </div>
        )}

        {tab === "sources" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Sources & Campaigns</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">
              CRM-visible sources from lead_sources. Platform remains the communication channel; source is marketing/intake attribution.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <PagedItems items={sources} render={(s) => <SourceCard key={s.id} src={s} />} />
            </div>
          </Card>
        )}

        {tab === "idRules" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">ID / MRN Rules</h3>
            <InfoGrid
              rows={[
                { label: "Lead ID generation", value: "crm_generate_lead_id()", hint: "New manual/imported leads call the database function. Existing IDs are never rewritten." },
                { label: "MRN", value: "Persisted field", hint: "Used for search and import matching when supplied; no retroactive auto-generation is enabled." },
              ]}
            />
          </Card>
        )}

        {tab === "duplicates" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Duplicate Rules</h3>
            <InfoGrid
              rows={[
                { label: "Phone", value: "Normalized phone tail", hint: "Search/import matching use normalized phone digits." },
                { label: "Platform ID", value: "Exact channel-scoped ID", hint: "Facebook, Instagram, and WhatsApp identifiers are not merged across channels." },
                { label: "Name similarity", value: "3+ name parts only", hint: "Both patient names must contain at least three meaningful parts. Two-part names are never matched by name alone." },
              ]}
            />
            <DuplicateBackfill canManage={canManage}/>
          </Card>
        )}

        {tab === "reporting" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Reporting Settings</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">Target CPL feeds the Auditor Dashboard finance section and red-flag detection.</p>
            <TargetsForm settings={auditorSettings} canManage={canManage} />
          </Card>
        )}

        {tab === "ai" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">AI Reply Assistant</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">The system prompt used to generate CRM suggested replies. Saving bumps the version.</p>
            <AiPromptForm prompt={aiPrompt} canManage={canManage} />
          </Card>
        )}

        {tab === "integrations" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Integrations</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">Server-side configuration status only. Secrets are never sent to the browser.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {integrations.map((item) => (
                <div key={item.key} className="rounded-control border border-line-soft p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="text-[13px] font-semibold text-ink-900">{item.label}</div>
                    <ConnectedBadge ok={item.configured} />
                  </div>
                  <div className="text-[11.5px] text-ink-500">{item.evidence}</div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === "ingestion" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Ingestion Log</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">Latest 30 message-ingestion events from the canonical ingest API log.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-[11.5px]"><thead><tr className="border-b text-left text-[10px] uppercase text-ink-400"><th className="py-2">Time</th><th>Platform</th><th>Event</th><th>Direction</th><th>User / conversation</th><th>Result</th><th>Message</th></tr></thead><tbody>{ingestLogs.map((row) => <tr key={row.id} className="border-b border-line-faint"><td className="py-2 tabular-nums">{formatDateTime(row.createdAt)}</td><td>{row.platform ?? row.source ?? "-"}</td><td>{row.eventType ?? "-"} {row.eventAction ?? ""}</td><td>{row.direction ?? "-"}</td><td className="max-w-[180px] truncate" data-no-translate>{row.platformUserId ?? row.conversationKey ?? "-"}</td><td>{row.skipped ? `Skipped: ${row.skipReason ?? "unknown"}` : row.errors.length ? "Error" : row.created ? "Created" : row.updated ? "Updated" : "Processed"}</td><td className="max-w-[260px] truncate" data-patient-content>{row.messageText ?? "-"}</td></tr>)}</tbody></table>{ingestLogs.length === 0 && <p className="py-5 text-center text-ink-400">No ingestion events recorded.</p>}</div>
          </Card>
        )}

        {tab === "users" && (
          <Card className="p-4"><h3 className="mb-1 text-[13px] font-bold text-ink-900">Users & Roles</h3><p className="mb-3 text-[11.5px] text-ink-500">Manage names, roles, activation, role history, and the latest 30 login/logout events per user.</p><Link href="/settings/users" className="inline-flex h-8 items-center rounded-control bg-primary px-3 text-[12px] font-semibold text-white">Open user management</Link></Card>
        )}

        {tab === "financial" && <div>{financial}</div>}

        {tab === "email" && (
          <div><EmailAutomationManager rules={emailRules} canManage={canManage}/><Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-[14px] font-black text-ink-900">Delivery history stays in Emails</div><div className="text-[11.5px] text-ink-500">Settings and automation logic are edited here; provider outcomes remain in the delivery log.</div></div><Link href="/emails" className="inline-flex h-9 items-center justify-center rounded-control border border-primary px-3 text-[12px] font-bold text-primary">Open delivery history</Link></Card></div>
        )}

        {tab === "scheduling" && <div>{scheduling}</div>}
      </div>
    </div>
  );
}
