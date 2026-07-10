"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  SETTINGS_IDLE,
  type SettingsActionState,
  upsertTagAction,
  upsertLostReasonAction,
  updateSlaRuleAction,
  upsertFollowUpStageAction,
  deleteFollowUpStageAction,
  updateAuditorTargetsAction,
  updateAiPromptAction,
  upsertEmailRuleAction,
  toggleEmailRuleAction,
} from "@/app/(crm)/settings/actions";
import { Card } from "@/components/ui/Card";
import type {
  TagSetting,
  LostReasonSetting,
  SlaRuleSetting,
  FollowUpStageSetting,
  AuditorSettingsRow,
  AiPromptSetting,
  EmailRuleSetting,
} from "@/lib/data/settingsData";

const field =
  "rounded-control border border-line-soft bg-white px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary disabled:opacity-60";
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

/* ── SLA rules ────────────────────────────────────────────────── */
function SlaForm({ rule, canManage }: { rule: SlaRuleSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(updateSlaRuleAction, SETTINGS_IDLE);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-b border-line-faint py-2.5 last:border-0">
      <input type="hidden" name="id" value={rule.id} />
      <div className="min-w-[150px] pb-2">
        <div className="text-[12.5px] font-bold text-ink-900">{rule.stageLabel}</div>
        <div className="text-[11px] text-ink-400">{rule.stageKey}</div>
      </div>
      <label className={label}>
        Reply deadline (min)
        <input type="number" name="replyDeadlineMinutes" min={1} defaultValue={rule.replyDeadlineMinutes} disabled={!canManage} className={`${field} w-28`} />
      </label>
      <label className={label}>
        Warn at (min)
        <input type="number" name="warningThresholdMinutes" min={0} defaultValue={rule.warningThresholdMinutes} disabled={!canManage} className={`${field} w-24`} />
      </label>
      <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
        <input type="checkbox" name="isActive" defaultChecked={rule.isActive} disabled={!canManage} /> Active
      </label>
      {canManage && <SaveButton pending={pending} />}
      <Feedback state={state} />
    </form>
  );
}

/* ── Follow-up workflow stages ────────────────────────────────── */
function FollowUpStageForm({ stage, canManage }: { stage?: FollowUpStageSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(upsertFollowUpStageAction, SETTINGS_IDLE);
  const [del, delAction, delPending] = useActionState(deleteFollowUpStageAction, SETTINGS_IDLE);
  return (
    <div className="border-b border-line-faint py-2.5 last:border-0">
      <form action={action} className="flex flex-wrap items-end gap-2">
        {stage && <input type="hidden" name="id" value={stage.id} />}
        <label className={label}>
          Type
          <select name="workflowType" defaultValue={stage?.workflowType ?? "regular"} disabled={!canManage} className={field}>
            <option value="regular">Regular</option>
            <option value="postop">Post-op</option>
          </select>
        </label>
        <label className={label}>
          Step name
          <input name="name" defaultValue={stage?.name ?? ""} required disabled={!canManage} className={`${field} min-w-[150px]`} />
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
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
          <input type="checkbox" name="isActive" defaultChecked={stage?.isActive ?? true} disabled={!canManage} /> Active
        </label>
        {canManage && <SaveButton pending={pending}>{stage ? "Save" : "Add step"}</SaveButton>}
        <Feedback state={state} />
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

/* ── Email rules ──────────────────────────────────────────────── */
function EmailRuleForm({ rule, canManage }: { rule?: EmailRuleSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(upsertEmailRuleAction, SETTINGS_IDLE);
  const [toggle, toggleAction, togglePending] = useActionState(toggleEmailRuleAction, SETTINGS_IDLE);
  const recips = rule?.recipients ?? [];
  const has = (t: string) => recips.some((r) => r.type === t);
  const statics = recips.filter((r) => r.type === "static").map((r) => r.value).join(", ");
  return (
    <div className="rounded-control border border-line-soft p-3">
      {rule && (
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`rounded-pill px-2 py-0.5 text-[10px] font-semibold ${rule.isActive ? "bg-emerald-100 text-emerald-700" : "bg-line-faint text-ink-500"}`}>
              {rule.isActive ? "Active" : "Disabled"}
            </span>
            <span className="font-mono text-[11px] text-ink-400">{rule.trigger}</span>
          </div>
          {canManage && (
            <form action={toggleAction}>
              <input type="hidden" name="id" value={rule.id} />
              <input type="hidden" name="isActive" value={rule.isActive ? "false" : "true"} />
              <button type="submit" disabled={togglePending} className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-60">
                {togglePending ? "…" : rule.isActive ? "Disable" : "Enable"}
              </button>
              <Feedback state={toggle} />
            </form>
          )}
        </div>
      )}
      <form action={action} className="flex flex-col gap-2">
        {rule && <input type="hidden" name="id" value={rule.id} />}
        <div className="flex flex-wrap gap-2">
          <label className={label}>
            Name
            <input name="name" defaultValue={rule?.name ?? ""} required disabled={!canManage} className={`${field} min-w-[200px]`} />
          </label>
          <label className={label}>
            Trigger
            <select name="trigger" defaultValue={rule?.trigger ?? "custom"} disabled={!canManage} className={field}>
              <option value="booking_created">booking_created</option>
              <option value="booking_under_review">booking_under_review</option>
              <option value="overdue_leads_daily">overdue_leads_daily</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label className={label}>
            Dedupe window (h)
            <input type="number" name="dedupeWindowHours" min={0} defaultValue={rule?.dedupeWindowHours ?? 24} disabled={!canManage} className={`${field} w-24`} />
          </label>
          <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700">
            <input type="checkbox" name="isActive" defaultChecked={rule?.isActive ?? false} disabled={!canManage} /> Active
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-700">
          <span className="text-[11px] font-semibold text-ink-500">Recipients:</span>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="toModerators" defaultChecked={has("moderators")} disabled={!canManage} /> Moderators</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="toAuditors" defaultChecked={has("auditors")} disabled={!canManage} /> Auditors</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" name="toInvolvedLead" defaultChecked={has("involved_lead")} disabled={!canManage} /> Involved lead</label>
          <input name="staticRecipients" defaultValue={statics} placeholder="extra@email.com, ..." disabled={!canManage} className={`${field} min-w-[220px] flex-1`} />
        </div>
        <label className={label}>
          Subject template
          <input name="subjectTemplate" defaultValue={rule?.subjectTemplate ?? ""} disabled={!canManage} className={field} />
        </label>
        <label className={label}>
          Body template (use {"{{variables}}"})
          <textarea name="bodyTemplate" defaultValue={rule?.bodyTemplate ?? ""} disabled={!canManage} rows={3} className={field} />
        </label>
        {canManage && (
          <div className="flex items-center gap-3">
            <SaveButton pending={pending}>{rule ? "Save rule" : "Create rule"}</SaveButton>
            <Feedback state={state} />
          </div>
        )}
      </form>
    </div>
  );
}

/* ── Shell ────────────────────────────────────────────────────── */
type TabKey = "tags" | "lost" | "sla" | "followup" | "targets" | "ai" | "email" | "scheduling";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "tags", label: "Tags" },
  { key: "lost", label: "Lost reasons" },
  { key: "sla", label: "SLA rules" },
  { key: "followup", label: "Follow-up rules" },
  { key: "targets", label: "Target CPL" },
  { key: "ai", label: "AI prompt" },
  { key: "email", label: "Email rules" },
  { key: "scheduling", label: "Scheduling" },
];

export function SettingsManager({
  canManage,
  tags,
  lostReasons,
  slaRules,
  followUpStages,
  auditorSettings,
  aiPrompt,
  emailRules,
  scheduling,
}: {
  canManage: boolean;
  tags: TagSetting[];
  lostReasons: LostReasonSetting[];
  slaRules: SlaRuleSetting[];
  followUpStages: FollowUpStageSetting[];
  auditorSettings: AuditorSettingsRow;
  aiPrompt: AiPromptSetting;
  emailRules: EmailRuleSetting[];
  scheduling: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("tags");

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
      <aside className="flex flex-row flex-wrap gap-1 lg:flex-col">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              "rounded-control px-3 py-2 text-left text-[12.5px] font-semibold transition-colors " +
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

        {tab === "tags" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Tags</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">Moderators may only apply tags from this list — they cannot invent new ones.</p>
            {tags.map((t) => <TagForm key={t.id} tag={t} canManage={canManage} />)}
            {canManage && <div className="mt-2"><TagForm canManage={canManage} /></div>}
          </Card>
        )}

        {tab === "lost" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Lost reasons</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">The controlled list a moderator must choose from when marking a lead Lost.</p>
            {lostReasons.map((r) => <LostReasonForm key={r.id} reason={r} canManage={canManage} />)}
            {canManage && <div className="mt-2"><LostReasonForm canManage={canManage} /></div>}
          </Card>
        )}

        {tab === "sla" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">SLA / response rules</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">Reply deadlines per lead stage. Drive overdue / unanswered highlighting.</p>
            {slaRules.length === 0 && <p className="text-[12px] text-ink-400">No stage reply rules configured.</p>}
            {slaRules.map((r) => <SlaForm key={r.id} rule={r} canManage={canManage} />)}
          </Card>
        )}

        {tab === "followup" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Follow-up rules</h3>
            <p className="mb-2 text-[11.5px] text-ink-500">Flexible sequences — any number of steps, arbitrary delays, per workflow type. Consumed by the Follow-Up tab.</p>
            {followUpStages.map((s) => <FollowUpStageForm key={s.id} stage={s} canManage={canManage} />)}
            {canManage && <div className="mt-2"><FollowUpStageForm canManage={canManage} /></div>}
          </Card>
        )}

        {tab === "targets" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Auditor targets</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">Target CPL feeds the Auditor Dashboard finance section and red-flag detection.</p>
            <TargetsForm settings={auditorSettings} canManage={canManage} />
          </Card>
        )}

        {tab === "ai" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">AI assistant prompt</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">The system prompt used to generate CRM suggested replies. Saving bumps the version.</p>
            <AiPromptForm prompt={aiPrompt} canManage={canManage} />
          </Card>
        )}

        {tab === "email" && (
          <Card className="p-4">
            <h3 className="mb-1 text-[13px] font-bold text-ink-900">Email automation rules</h3>
            <p className="mb-3 text-[11.5px] text-ink-500">Rules are disabled by default. Review recipients and templates, then enable. Sends are logged in Emails.</p>
            <div className="flex flex-col gap-3">
              {emailRules.map((r) => <EmailRuleForm key={r.id} rule={r} canManage={canManage} />)}
              {canManage && <EmailRuleForm canManage={canManage} />}
            </div>
          </Card>
        )}

        {tab === "scheduling" && <div>{scheduling}</div>}
      </div>
    </div>
  );
}
