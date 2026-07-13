"use client";

import { Fragment, useActionState, useState } from "react";
import {
  upsertEmailRuleAction,
  toggleEmailRuleAction,
  type SettingsActionState,
} from "@/app/(crm)/settings/actions";
import type { EmailRuleSetting } from "@/lib/data/settingsData";

const IDLE: SettingsActionState = { ok: false };
const input = "h-10 w-full rounded-control border border-line-soft bg-white px-3 text-[13px] text-ink-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-line-faint";
const label = "flex flex-col gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-500";

const TRIGGERS = {
  booking_created: { label: "Booking created", color: "bg-blue-100 text-blue-700", hint: "Runs immediately after a CRM or website booking is created.", variables: "patient_name, patient_email, appointment_date, appointment_datetime, service_name" },
  booking_status_changed: { label: "Booking status changes", color: "bg-violet-100 text-violet-700", hint: "Runs when a booking moves between statuses.", variables: "patient_name, lead_id, appointment_id, from_status, to_status" },
  lead_status_changed: { label: "Lead status changes", color: "bg-amber-100 text-amber-800", hint: "Runs when a lead moves to a new pipeline stage.", variables: "patient_name, lead_id, from_status, to_status" },
  followup_reminder: { label: "Next follow-up reminder", color: "bg-emerald-100 text-emerald-700", hint: "Runs from the automation scheduler before a follow-up is due.", variables: "patient_name, lead_id, followup_number, followup_due_at, workflow_type, notes" },
  overdue_leads_daily: { label: "Overdue daily summary", color: "bg-red-100 text-red-700", hint: "Runs from the daily overdue scheduler.", variables: "overdue_count, report_date" },
  custom: { label: "Custom event", color: "bg-slate-100 text-slate-700", hint: "Reserved for a custom integration event.", variables: "Depends on the integration payload" },
} as const;

type TriggerKey = keyof typeof TRIGGERS;
const LEAD_STATUSES = ["new_lead", "qualified", "booked", "follow_up", "post_op_follow_up", "lost"];
const BOOKING_STATUSES = ["reserved", "confirmed", "attended", "cancelled", "no_show", "rescheduled"];

function Feedback({ state }: { state: SettingsActionState }) {
  if (state.error) return <span className="text-[11px] font-semibold text-red-600">{state.error}</span>;
  if (state.ok && state.message) return <span className="text-[11px] font-semibold text-emerald-600">{state.message}</span>;
  return null;
}

function ConditionFields({ trigger, rule }: { trigger: TriggerKey; rule?: EmailRuleSetting }) {
  const conditions = rule?.conditions ?? {};
  if (trigger === "lead_status_changed" || trigger === "booking_status_changed") {
    const statuses = trigger === "lead_status_changed" ? LEAD_STATUSES : BOOKING_STATUSES;
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>From status
          <select name="fromStatus" defaultValue={String(conditions.from_status ?? "")} className={input}>
            <option value="">Any previous status</option>
            {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className={label}>To status
          <select name="toStatus" defaultValue={String(conditions.to_status ?? "")} className={input}>
            <option value="">Any new status</option>
            {statuses.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}
          </select>
        </label>
      </div>
    );
  }
  if (trigger === "followup_reminder") {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <input type="hidden" name="cron" value={String(rule?.schedule.cron ?? "0 * * * *")} />
        <label className={label}>Workflow
          <select name="workflowType" defaultValue={String(conditions.workflow_type ?? "")} className={input}>
            <option value="">Regular + post-op</option>
            <option value="follow_up">Regular follow-up</option>
            <option value="post_op">Post-op follow-up</option>
          </select>
        </label>
        <label className={label}>Send before due
          <select name="hoursBefore" defaultValue={String(conditions.hours_before ?? 24)} className={input}>
            <option value="1">1 hour</option><option value="3">3 hours</option><option value="12">12 hours</option>
            <option value="24">1 day</option><option value="48">2 days</option><option value="72">3 days</option>
          </select>
        </label>
        <label className={label}>Scheduler timezone
          <input name="timezone" defaultValue={String(rule?.schedule.timezone ?? "Africa/Cairo")} className={input} />
        </label>
      </div>
    );
  }
  if (trigger === "overdue_leads_daily") {
    return <input type="hidden" name="cron" value={String(rule?.schedule.cron ?? "0 9 * * *")} />;
  }
  return null;
}

function AutomationEditor({ rule, canManage, onClose }: { rule?: EmailRuleSetting; canManage: boolean; onClose?: () => void }) {
  const [state, action, pending] = useActionState(upsertEmailRuleAction, IDLE);
  const initial = (rule?.trigger && rule.trigger in TRIGGERS ? rule.trigger : "custom") as TriggerKey;
  const [trigger, setTrigger] = useState<TriggerKey>(initial);
  const recips = rule?.recipients ?? [];
  const has = (type: string) => recips.some((recipient) => recipient.type === type);
  const statics = recips.filter((recipient) => recipient.type === "static").map((recipient) => String(recipient.value ?? "")).join(", ");

  return (
    <form action={action} className="space-y-4 rounded-card border border-line-soft bg-panel p-4 sm:p-5">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary">{rule ? "Edit automation" : "New automation"}</div>
          <h3 className="mt-1 text-[18px] font-bold text-ink-950">{rule?.name ?? "Define when the email should run"}</h3>
        </div>
        {onClose && <button type="button" onClick={onClose} className="text-[12px] font-semibold text-ink-500 hover:text-ink-900">Close</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>Automation name
          <input name="name" defaultValue={rule?.name ?? ""} required className={input} placeholder="e.g. Confirmed booking alert" />
        </label>
        <label className={label}>Event
          <select name="trigger" value={trigger} onChange={(event) => setTrigger(event.target.value as TriggerKey)} className={input}>
            {Object.entries(TRIGGERS).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
          </select>
        </label>
      </div>
      <p className="rounded-control bg-line-faint px-3 py-2 text-[12px] text-ink-600">{TRIGGERS[trigger].hint}</p>
      <ConditionFields key={trigger} trigger={trigger} rule={rule} />
      <label className={label}>Purpose (shown to administrators)
        <input name="description" defaultValue={rule?.description ?? ""} className={input} placeholder="Explain why this automation exists" />
      </label>
      <div className="rounded-control border border-line-soft bg-white p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-ink-500">Recipients</div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-700">
          <label className="flex items-center gap-2"><input type="checkbox" name="toModerators" defaultChecked={has("moderators")} /> Moderators</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="toAuditors" defaultChecked={has("auditors")} /> Auditors</label>
          <label className="flex items-center gap-2"><input type="checkbox" name="toInvolvedLead" defaultChecked={has("involved_lead")} /> Patient, when booking email exists</label>
        </div>
        <input name="staticRecipients" defaultValue={statics} className={`${input} mt-3`} placeholder="Additional addresses, separated by commas" />
      </div>
      <div className="grid gap-3">
        <label className={label}>Subject
          <input name="subjectTemplate" defaultValue={rule?.subjectTemplate ?? ""} required className={input} placeholder="Follow-up due for {{patient_name}}" />
        </label>
        <label className={label}>Message
          <textarea name="bodyTemplate" defaultValue={rule?.bodyTemplate ?? ""} required rows={5} className={`${input} h-auto py-3 leading-5`} placeholder="Use {{patient_name}} and the variables below." />
        </label>
        <div className="text-[11px] text-ink-500"><span className="font-bold text-ink-700">Available variables:</span> {TRIGGERS[trigger].variables}</div>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-line-faint pt-4">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-800">
          <input type="checkbox" name="isActive" defaultChecked={rule?.isActive ?? true} /> Turn on after saving
        </label>
        <label className="flex items-center gap-2 text-[12px] text-ink-600">Repeat protection
          <select name="dedupeWindowHours" defaultValue={rule?.dedupeWindowHours ?? 24} className="h-9 rounded-control border border-line-soft bg-white px-2">
            <option value="1">1 hour</option><option value="6">6 hours</option><option value="24">24 hours</option><option value="168">7 days</option><option value="0">Once per event forever</option>
          </select>
        </label>
        <button type="submit" disabled={!canManage || pending} className="ms-auto h-10 rounded-control bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary-hover disabled:opacity-50">
          {pending ? "Saving…" : rule ? "Save changes" : "Create automation"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

function AutomationCard({ rule, canManage }: { rule: EmailRuleSetting; canManage: boolean }) {
  const [state, action, pending] = useActionState(toggleEmailRuleAction, IDLE);
  const [editing, setEditing] = useState(false);
  const key = (rule.trigger in TRIGGERS ? rule.trigger : "custom") as TriggerKey;
  const meta = TRIGGERS[key];
  const recipients = rule.recipients.map((recipient) => recipient.type === "static" ? String(recipient.value ?? "email") : String(recipient.type).replaceAll("_", " "));
  if (editing) return <AutomationEditor rule={rule} canManage={canManage} onClose={() => setEditing(false)} />;
  return (
    <article className="rounded-card border border-line-soft bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 rounded-control px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>{meta.label}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold text-ink-950">{rule.name}</h3>
            <span className={`size-2 rounded-full ${rule.isActive ? "bg-emerald-500" : "bg-ink-300"}`} />
            <span className="text-[11px] font-semibold text-ink-500">{rule.isActive ? "On" : "Off"}</span>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-ink-500">{rule.description || meta.hint}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 border-y border-line-faint py-3 sm:grid-cols-2">
        <div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Recipients</div><div className="mt-1 text-[12px] font-semibold text-ink-700">{recipients.length ? recipients.map((recipient, index) => <Fragment key={`${recipient}-${index}`}>{index > 0 && ", "}<span>{recipient}</span></Fragment>) : "No recipients configured"}</div></div>
        <div><div className="text-[10px] font-bold uppercase tracking-wide text-ink-400">Subject</div><div className="mt-1 truncate text-[12px] font-semibold text-ink-700">{rule.subjectTemplate || "No subject"}</div></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {canManage && <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-bold text-primary hover:underline">Edit logic & message</button>}
        {canManage && (
          <form action={action} className="ms-auto flex items-center gap-2">
            <input type="hidden" name="id" value={rule.id} />
            <input type="hidden" name="isActive" value={rule.isActive ? "false" : "true"} />
            <button type="submit" disabled={pending} className={`h-8 rounded-control px-3 text-[11px] font-bold ${rule.isActive ? "border border-line-soft text-ink-700" : "bg-emerald-600 text-white"}`}>
              {pending ? "…" : rule.isActive ? "Turn off" : "Turn on"}
            </button>
          </form>
        )}
        <Feedback state={state} />
      </div>
    </article>
  );
}

export function EmailAutomationManager({ rules, canManage }: { rules: EmailRuleSetting[]; canManage: boolean }) {
  const [creating, setCreating] = useState(false);
  const active = rules.filter((rule) => rule.isActive).length;
  return (
    <section className="mb-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
        <div><h1 className="text-[24px] font-bold text-ink-950">Email automations</h1><p className="mt-0.5 text-[12px] text-ink-500">Trigger messages from lead, booking and follow-up events.</p></div>
        <div className="text-[11px] font-bold text-ink-500"><span className="text-primary">{active} active</span> · {rules.length} total</div>
      </div>
      <div className="flex items-center justify-between gap-3"><div><h2 className="text-[18px] font-bold text-ink-950">Automations</h2><p className="text-[12px] text-ink-500">Changes take effect immediately; turn a rule off without deleting its setup.</p></div>{canManage && <button type="button" onClick={() => setCreating((value) => !value)} className="h-10 rounded-control bg-primary px-4 text-[13px] font-bold text-white hover:bg-primary-hover">{creating ? "Close builder" : "+ New automation"}</button>}</div>
      {creating && <AutomationEditor canManage={canManage} onClose={() => setCreating(false)} />}
      <div className="grid gap-3 xl:grid-cols-2">{rules.map((rule) => <AutomationCard key={rule.id} rule={rule} canManage={canManage} />)}</div>
      {!canManage && <p className="rounded-control border border-line-soft bg-panel px-3 py-2 text-[12px] text-ink-600">You can review automations and delivery history. An administrator or auditor can change automation logic.</p>}
    </section>
  );
}
