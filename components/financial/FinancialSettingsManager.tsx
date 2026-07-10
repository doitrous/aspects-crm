"use client";

import { useActionState, useMemo, useState } from "react";
import {
  addFinancialDoctorAction,
  upsertConsumableComponentAction,
  upsertDiscountRuleAction,
  upsertDoctorCompRuleAction,
  upsertExternalCostDefaultAction,
  upsertServiceConsumableDefaultAction,
  upsertServicePriceAction,
  type FinancialSettingsActionState,
} from "@/app/(crm)/financial/settings/actions";
import { Card } from "@/components/ui/Card";
import type { FinancialSettingsData, FinancialServiceSetting } from "@/lib/data/financialSettings";

const IDLE: FinancialSettingsActionState = {};
const field = "rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary disabled:opacity-60";
const label = "flex flex-col gap-1 text-[11px] font-semibold text-ink-500";

type Tab =
  | "overview"
  | "services"
  | "discounts"
  | "consumables"
  | "doctors"
  | "payments"
  | "external"
  | "exceptional"
  | "reports"
  | "general";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "services", label: "Service Pricing" },
  { key: "discounts", label: "Discount Rules" },
  { key: "consumables", label: "Consumables" },
  { key: "doctors", label: "Doctor Compensation" },
  { key: "payments", label: "Payment Methods" },
  { key: "external", label: "External Cost Defaults" },
  { key: "exceptional", label: "Exceptional Pricing" },
  { key: "reports", label: "Financial Reports" },
  { key: "general", label: "General Financial Settings" },
];

function Feedback({ state }: { state: FinancialSettingsActionState }) {
  if (state.error) return <span className="text-[11px] font-semibold text-red-600">{state.error}</span>;
  if (state.ok) return <span className="text-[11px] font-semibold text-emerald-600">{state.ok}</span>;
  return null;
}

function Save({ pending, children = "Save" }: { pending: boolean; children?: string }) {
  return (
    <button type="submit" disabled={pending} className="h-8 rounded-control bg-primary px-3 text-[12px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60">
      {pending ? "Saving..." : children}
    </button>
  );
}

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function serviceRef(s: FinancialServiceSetting): string {
  return `${s.serviceId ?? ""}::${s.serviceName}`;
}

function ServiceOptions({ services }: { services: FinancialServiceSetting[] }) {
  return (
    <>
      <option value="">Any / no service</option>
      {services.map((s) => (
        <option key={`${s.serviceId ?? s.serviceName}-${s.id ?? ""}`} value={serviceRef(s)}>
          {s.serviceName}
        </option>
      ))}
    </>
  );
}

function ServicePriceForm({ service }: { service: FinancialServiceSetting }) {
  const [state, action, pending] = useActionState(upsertServicePriceAction, IDLE);
  return (
    <form action={action} className="grid gap-2 border-b border-line-faint py-2.5 last:border-0 md:grid-cols-[minmax(220px,1fr)_110px_90px_120px_120px_90px_auto] md:items-end">
      {service.id && <input type="hidden" name="id" value={service.id} />}
      <input type="hidden" name="serviceId" value={service.serviceId ?? ""} />
      <input type="hidden" name="serviceName" value={service.serviceName} />
      <div className="pb-1">
        <div className="text-[12.5px] font-bold text-ink-900">{service.serviceName}</div>
        <div className="text-[10.5px] text-ink-400">{service.specialtyName ?? "No specialty"} {service.serviceCode ? `- ${service.serviceCode}` : ""}</div>
      </div>
      <label className={label}>Base price<input name="basePrice" type="number" min={0} step="0.01" defaultValue={service.basePrice} className={field} /></label>
      <label className={label}>Currency<input name="currency" defaultValue={service.currency} className={field} /></label>
      <label className={label}>Consumables<input name="defaultConsumablesCost" type="number" min={0} step="0.01" defaultValue={service.defaultConsumablesCost} className={field} /></label>
      <label className={label}>Effective from<input name="effectiveFrom" type="date" defaultValue={service.effectiveFrom ?? ""} className={field} /></label>
      <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked={service.active} /> Active</label>
      <div className="flex items-center gap-2"><Save pending={pending} /><Feedback state={state} /></div>
    </form>
  );
}

function Discounts({ data }: { data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertDiscountRuleAction, IDLE);
  return (
    <Card className="p-4">
      <h3 className="mb-1 text-[13px] font-bold text-ink-900">Discount Rules</h3>
      <p className="mb-3 text-[11.5px] text-ink-500">Precedence is moderator + service, moderator, service, global. The Payments tab resolves this on every quote save.</p>
      <form action={action} className="mb-4 grid gap-2 md:grid-cols-4 md:items-end">
        <label className={label}>Scope<select name="scope" className={field} defaultValue="global"><option value="global">Global</option><option value="service">Service</option><option value="moderator">Moderator</option><option value="moderator_service">Moderator + Service</option></select></label>
        <label className={label}>Moderator<select name="moderatorId" className={field}><option value="">Any</option>{data.moderators.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className={label}>Service<select name="serviceRef" className={field}><ServiceOptions services={data.services} /></select></label>
        <label className={label}>Max discount %<input name="maxDiscountPct" type="number" min={0} max={100} step="0.01" required className={field} /></label>
        <label className={label}>Effective from<input name="effectiveFrom" type="date" className={field} /></label>
        <label className={label}>Effective to<input name="effectiveTo" type="date" className={field} /></label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked /> Active</label>
        <div className="flex items-center gap-2"><Save pending={pending}>Add rule</Save><Feedback state={state} /></div>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px]"><thead><tr className="border-b border-line-soft text-left text-[10px] uppercase text-ink-400"><th className="py-1.5">Scope</th><th>Moderator</th><th>Service</th><th>Max</th><th>Window</th><th>State</th></tr></thead><tbody>{data.discountRules.map((r) => <tr key={r.id} className="border-b border-line-faint"><td className="py-1.5">{r.scope}</td><td>{r.moderatorName ?? "-"}</td><td>{r.serviceName ?? r.serviceId ?? "-"}</td><td>{r.maxDiscountPct}%</td><td>{r.effectiveFrom ?? "now"} - {r.effectiveTo ?? "open"}</td><td>{r.active ? "Active" : "Off"}</td></tr>)}</tbody></table>
      </div>
    </Card>
  );
}

function Consumables({ data }: { data: FinancialSettingsData }) {
  const [componentState, componentAction, componentPending] = useActionState(upsertConsumableComponentAction, IDLE);
  const [defaultState, defaultAction, defaultPending] = useActionState(upsertServiceConsumableDefaultAction, IDLE);
  return (
    <Card className="p-4">
      <h3 className="mb-1 text-[13px] font-bold text-ink-900">Consumables</h3>
      <p className="mb-3 text-[11.5px] text-ink-500">Global consumable components plus service-specific defaults. Patient overrides stay on the lead and never change these defaults.</p>
      <form action={componentAction} className="mb-3 flex flex-wrap items-end gap-2">
        <label className={label}>Component<input name="name" required className={`${field} min-w-[180px]`} /></label>
        <label className={label}>Unit cost<input name="unitCost" type="number" min={0} step="0.01" required className={`${field} w-28`} /></label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked /> Active</label>
        <Save pending={componentPending}>Add component</Save><Feedback state={componentState} />
      </form>
      <form action={defaultAction} className="mb-4 grid gap-2 md:grid-cols-5 md:items-end">
        <label className={label}>Service<select name="serviceRef" required className={field}><ServiceOptions services={data.services} /></select></label>
        <label className={label}>Description<input name="description" required className={field} /></label>
        <label className={label}>Qty<input name="quantity" type="number" min={0.001} step="0.001" defaultValue={1} className={field} /></label>
        <label className={label}>Unit cost<input name="unitCost" type="number" min={0} step="0.01" required className={field} /></label>
        <div className="flex items-center gap-2"><input type="hidden" name="active" value="true" /><Save pending={defaultPending}>Add default</Save><Feedback state={defaultState} /></div>
      </form>
      <div className="grid gap-3 md:grid-cols-2">
        <div><h4 className="mb-1 text-[12px] font-bold text-ink-800">Components</h4>{data.consumableComponents.map((c) => <div key={c.id} className="flex justify-between border-b border-line-faint py-1 text-[12px]"><span>{c.name}</span><span>{money(c.unitCost)} EGP {c.active ? "" : "(off)"}</span></div>)}</div>
        <div><h4 className="mb-1 text-[12px] font-bold text-ink-800">Service defaults</h4>{data.serviceConsumableDefaults.map((c) => <div key={c.id} className="border-b border-line-faint py-1 text-[12px]"><span className="font-semibold">{c.serviceName}</span> - {c.description}: {money(c.totalCost)} EGP {c.active ? "" : "(off)"}</div>)}</div>
      </div>
    </Card>
  );
}

function Doctors({ data }: { data: FinancialSettingsData }) {
  const [ruleState, ruleAction, rulePending] = useActionState(upsertDoctorCompRuleAction, IDLE);
  const [doctorState, doctorAction, doctorPending] = useActionState(addFinancialDoctorAction, IDLE);
  const activeDoctor = useMemo(() => new Map(data.doctors.doctors.map((d) => [d.id, d])), [data.doctors.doctors]);
  return (
    <Card className="p-4">
      <h3 className="mb-1 text-[13px] font-bold text-ink-900">Doctor Compensation</h3>
      <p className="mb-3 text-[11.5px] text-ink-500">Doctors are read from the Admin booking catalog. New CRM-created doctors are inserted there as inactive/not bookable.</p>
      {!data.doctors.configured && <p className="mb-3 rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">Booking/Admin doctor source is not configured.</p>}
      <form action={doctorAction} className="mb-4 grid gap-2 md:grid-cols-5 md:items-end">
        <label className={label}>Name EN<input name="nameEn" required className={field} /></label>
        <label className={label}>Title<input name="titleEn" className={field} /></label>
        <label className={label}>Specialty<select name="specialtyId" required className={field}><option value="">Choose</option>{data.doctors.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></label>
        <label className={label}>Consultation fee<input name="consultationFee" type="number" min={0} step="0.01" className={field} /></label>
        <div className="flex items-center gap-2"><Save pending={doctorPending}>Add inactive doctor</Save><Feedback state={doctorState} /></div>
      </form>
      <form action={ruleAction} className="mb-4 grid gap-2 md:grid-cols-4 md:items-end">
        <label className={label}>Doctor<select name="doctorId" required className={field}><option value="">Choose doctor</option>{data.doctors.doctors.map((d) => <option key={d.id} value={d.id}>{d.nameEn}{d.active ? "" : " (inactive)"}</option>)}</select></label>
        <label className={label}>Doctor name<input name="doctorName" className={field} placeholder="Optional freeze label" /></label>
        <label className={label}>Service<select name="serviceRef" className={field}><ServiceOptions services={data.services} /></select></label>
        <label className={label}>Kind<select name="kind" className={field}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>
        <label className={label}>Value<input name="value" type="number" min={0} step="0.01" required className={field} /></label>
        <label className={label}>Basis<select name="basis" className={field}><option value="quoted_price">Quoted price</option><option value="net_after_consumables">Net after consumables</option></select></label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked /> Active</label>
        <div className="flex items-center gap-2"><Save pending={rulePending}>Add rule</Save><Feedback state={ruleState} /></div>
      </form>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[12px]"><thead><tr className="border-b border-line-soft text-left text-[10px] uppercase text-ink-400"><th className="py-1.5">Doctor</th><th>Service</th><th>Rule</th><th>Basis</th><th>State</th></tr></thead><tbody>{data.doctorCompRules.map((r) => <tr key={r.id} className="border-b border-line-faint"><td className="py-1.5">{r.doctorName ?? activeDoctor.get(r.doctorId)?.nameEn ?? r.doctorId}</td><td>{r.serviceName ?? r.serviceId ?? "Any"}</td><td>{r.kind === "fixed" ? `${money(r.value)} EGP` : `${r.value}%`}</td><td>{r.basis}</td><td>{r.active ? "Active" : "Off"}</td></tr>)}</tbody></table>
      </div>
    </Card>
  );
}

function ExternalDefaults({ data }: { data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertExternalCostDefaultAction, IDLE);
  return (
    <Card className="p-4">
      <h3 className="mb-1 text-[13px] font-bold text-ink-900">External Cost Categories / Defaults</h3>
      <form action={action} className="mb-4 grid gap-2 md:grid-cols-5 md:items-end">
        <label className={label}>Service<select name="serviceRef" required className={field}><ServiceOptions services={data.services} /></select></label>
        <label className={label}>Category<select name="category" className={field}>{data.externalCostCategories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className={label}>Description<input name="description" required className={field} /></label>
        <label className={label}>Amount<input name="amount" type="number" min={0} step="0.01" required className={field} /></label>
        <label className={label}>Vendor<input name="vendor" className={field} /></label>
        <input type="hidden" name="active" value="true" />
        <div className="flex items-center gap-2"><Save pending={pending}>Add default</Save><Feedback state={state} /></div>
      </form>
      {data.externalCostDefaults.map((e) => <div key={e.id} className="border-b border-line-faint py-1 text-[12px]"><span className="font-semibold">{e.serviceName}</span> - {e.category}: {e.description} {money(e.amount)} EGP {e.active ? "" : "(off)"}</div>)}
    </Card>
  );
}

export function FinancialSettingsManager({ data }: { data: FinancialSettingsData }) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <aside className="flex flex-row flex-wrap gap-1 lg:flex-col">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={"rounded-control px-3 py-2 text-left text-[12.5px] font-semibold " + (tab === t.key ? "bg-primary-soft text-primary" : "text-ink-600 hover:bg-line-faint/60")}>{t.label}</button>)}
      </aside>
      <div className="min-w-0">
        {tab === "overview" && <Card className="p-4"><h3 className="mb-2 text-[13px] font-bold text-ink-900">Financial Settings Overview</h3><div className="grid gap-2 sm:grid-cols-3"><Stat label="Canonical services" value={String(data.services.length)} /><Stat label="Pricing rows" value={String(data.services.filter((s) => s.id).length)} /><Stat label="Discount rules" value={String(data.discountRules.length)} /><Stat label="Admin doctors" value={String(data.doctors.doctors.length)} /><Stat label="Doctor comp rules" value={String(data.doctorCompRules.length)} /><Stat label="Default cost templates" value={String(data.serviceConsumableDefaults.length + data.externalCostDefaults.length)} /></div></Card>}
        {tab === "services" && <Card className="p-4"><h3 className="mb-1 text-[13px] font-bold text-ink-900">Service Pricing</h3><p className="mb-3 text-[11.5px] text-ink-500">All services come from the canonical Admin booking catalog when configured. Existing patient financial records keep frozen historical base prices.</p>{data.services.map((s) => <ServicePriceForm key={`${s.serviceId ?? s.serviceName}-${s.id ?? ""}`} service={s} />)}</Card>}
        {tab === "discounts" && <Discounts data={data} />}
        {tab === "consumables" && <Consumables data={data} />}
        {tab === "doctors" && <Doctors data={data} />}
        {tab === "payments" && <Card className="p-4"><h3 className="mb-1 text-[13px] font-bold text-ink-900">Payment Methods</h3><p className="mb-2 text-[11.5px] text-ink-500">These are the canonical ledger payment method enum values used by Payments, Bulk Import, and reports.</p><div className="flex flex-wrap gap-2">{data.paymentMethods.map((m) => <span key={m} className="rounded-pill bg-line-faint px-2.5 py-1 text-[12px] font-semibold text-ink-700">{m}</span>)}</div></Card>}
        {tab === "external" && <ExternalDefaults data={data} />}
        {tab === "exceptional" && <Card className="p-4"><h3 className="mb-1 text-[13px] font-bold text-ink-900">Exceptional Pricing</h3><p className="mb-3 text-[11.5px] text-ink-500">Exceptional pricing uses `crm_discount_approvals` plus the existing escalation workflow. Approvals are handled from lead Payments and the Financial Dashboard exceptions view.</p><a href="/financial?tab=exceptions" className="text-[12px] font-semibold text-primary hover:underline">Open exceptional pricing cases</a></Card>}
        {tab === "reports" && <Card className="p-4"><h3 className="mb-1 text-[13px] font-bold text-ink-900">Financial Reports</h3><p className="mb-3 text-[11.5px] text-ink-500">Reports read the same canonical financial tables and preserve the cash-flow vs profitability date basis.</p><a href="/financial" className="text-[12px] font-semibold text-primary hover:underline">Open Financial Dashboard</a></Card>}
        {tab === "general" && <Card className="p-4"><h3 className="mb-1 text-[13px] font-bold text-ink-900">General Financial Settings</h3><p className="mb-3 text-[11.5px] text-ink-500">Financial records freeze base service price when a lead financial record is created. Payment transactions are append-only. Refunds/reversals/chargebacks reference original payments.</p><div className="grid gap-2 sm:grid-cols-2"><Stat label="Currency default" value="EGP" /><Stat label="Cash-flow basis" value="Payment date" /><Stat label="Profitability basis" value="Service date" /><Stat label="Doctor-funded payments" value="Separate from compensation" /></div></Card>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-control border border-line-soft p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{label}</div><div className="mt-1 text-[14px] font-bold text-ink-900">{value}</div></div>;
}
