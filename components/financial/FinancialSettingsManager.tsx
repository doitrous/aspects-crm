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
  deleteDiscountRuleAction,
  setFinancialSettingActiveAction,
  upsertAddonRuleAction,
  upsertBundleAction,
  addBundleComponentAction,
  upsertPaymentMethodAction,
  upsertStaffCommissionAction,
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
  | "commissions"
  | "bundles"
  | "payments"
  | "exceptional"
  | "reports"
  | "general";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "services", label: "Service Pricing" },
  { key: "discounts", label: "Discount Rules" },
  { key: "consumables", label: "Consumables" },
  { key: "doctors", label: "Doctor Compensation" },
  { key: "commissions", label: "Moderator Commissions" },
  { key: "bundles", label: "Bundles & Add-ons" },
  { key: "payments", label: "Payment Methods" },
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

function ActiveToggle({ table, id, active }: { table: string; id: string; active: boolean }) {
  const [state, action, pending] = useActionState(setFinancialSettingActiveAction, IDLE);
  return <form action={action} className="inline-flex items-center gap-1">
    <input type="hidden" name="table" value={table} /><input type="hidden" name="id" value={id} />
    <input type="hidden" name="active" value={String(!active)} />
    <button disabled={pending} className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50">{pending ? "Saving..." : active ? "Deactivate" : "Activate"}</button>
    <Feedback state={state} />
  </form>;
}

function Discounts({ data }: { data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertDiscountRuleAction, IDLE);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(data.discountRules.length / 30));
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
        <table className="w-full min-w-[860px] text-[12px]"><thead><tr className="border-b border-line-soft text-left text-[10px] uppercase text-ink-400"><th className="py-1.5">Scope</th><th>Moderator</th><th>Service</th><th>Max</th><th>Window</th><th>State</th><th>Actions</th></tr></thead><tbody>{data.discountRules.slice((page - 1) * 30, page * 30).map((r) => <DiscountRuleRow key={r.id} rule={r} />)}</tbody></table>
      </div>
      {pages > 1 && <div className="mt-3 flex items-center justify-between text-[11.5px]"><button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="font-semibold text-primary disabled:text-ink-300">Previous</button><span>Page {page} of {pages}</span><button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="font-semibold text-primary disabled:text-ink-300">Next</button></div>}
    </Card>
  );
}

function DiscountRuleRow({ rule: r }: { rule: FinancialSettingsData["discountRules"][number] }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState(upsertDiscountRuleAction, IDLE);
  const [delState, delAction, delPending] = useActionState(deleteDiscountRuleAction, IDLE);
  if (editing) return <tr className="border-b border-line-faint"><td colSpan={7} className="py-2"><form action={action} className="flex flex-wrap items-end gap-2">
    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="scope" value={r.scope} />
    <input type="hidden" name="moderatorId" value={r.moderatorId ?? ""} /><input type="hidden" name="serviceId" value={r.serviceId ?? ""} /><input type="hidden" name="serviceName" value={r.serviceName ?? ""} />
    <label className={label}>Maximum discount %<input className={field} name="maxDiscountPct" type="number" min={0} max={100} step="0.01" defaultValue={r.maxDiscountPct} /></label>
    <label className={label}>Effective from<input className={field} name="effectiveFrom" type="date" defaultValue={r.effectiveFrom ?? ""} /></label>
    <label className={label}>Effective to<input className={field} name="effectiveTo" type="date" defaultValue={r.effectiveTo ?? ""} /></label>
    <label className="pb-2 text-[12px]"><input name="active" type="checkbox" defaultChecked={r.active} /> Active</label>
    <Save pending={pending} /><button type="button" onClick={() => setEditing(false)} className="h-8 px-2 text-[12px]">Cancel</button><Feedback state={state} />
  </form></td></tr>;
  return <tr className="border-b border-line-faint"><td className="py-1.5">{r.scope}</td><td>{r.moderatorName ?? "-"}</td><td>{r.serviceName ?? r.serviceId ?? "-"}</td><td>{r.maxDiscountPct}%</td><td>{r.effectiveFrom ?? "now"} - {r.effectiveTo ?? "open"}</td><td>{r.active ? "Active" : "Off"}</td><td className="flex gap-2 py-1.5"><button onClick={() => setEditing(true)} className="font-semibold text-primary">Edit</button><form action={delAction}><input type="hidden" name="id" value={r.id} /><button disabled={delPending} className="font-semibold text-red-600">{delPending ? "Deleting..." : "Delete"}</button></form><Feedback state={delState} /></td></tr>;
}

function Consumables({ data }: { data: FinancialSettingsData }) {
  const [page, setPage] = useState(1);
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
      <div className="mb-4"><h4 className="mb-1 text-[12px] font-bold text-ink-800">Components</h4>{data.consumableComponents.map((c) => <div key={c.id} className="flex justify-between border-b border-line-faint py-1 text-[12px]"><span>{c.name}</span><span>{money(c.unitCost)} EGP {c.active ? "" : "(off)"}</span></div>)}</div>
      <h4 className="mb-2 text-[12px] font-bold text-ink-800">All canonical services</h4>
      <div className="grid gap-2 md:grid-cols-2">
        {data.services.slice((page - 1) * 30, page * 30).map((service) => {
          const defaults = data.serviceConsumableDefaults.filter((item) => item.serviceId ? item.serviceId === service.serviceId : item.serviceName === service.serviceName);
          return <div key={serviceRef(service)} className="border-b border-line-faint py-2"><div className="text-[12px] font-bold text-ink-800">{service.serviceName}</div>{defaults.length ? defaults.map((item) => <div key={item.id} className="text-[11.5px] text-ink-600">{item.description}: {money(item.totalCost)} EGP {item.active ? "" : "(inactive)"}</div>) : <div className="text-[11.5px] font-medium text-amber-700">No consumables configured</div>}</div>;
        })}
      </div>
      {data.services.length > 30 && <div className="mt-3 flex items-center justify-between text-[11.5px]"><button disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="font-semibold text-primary disabled:text-ink-300">Previous</button><span>Page {page} of {Math.ceil(data.services.length / 30)}</span><button disabled={page >= Math.ceil(data.services.length / 30)} onClick={() => setPage((value) => value + 1)} className="font-semibold text-primary disabled:text-ink-300">Next</button></div>}
      <div className="mt-5 border-t border-line-soft pt-4"><ExternalDefaults data={data} /></div>
    </Card>
  );
}

function Bundles({ data }: { data: FinancialSettingsData }) {
  const [bundleState, bundleAction, bundlePending] = useActionState(upsertBundleAction, IDLE);
  const [addonState, addonAction, addonPending] = useActionState(upsertAddonRuleAction, IDLE);
  const [componentState, componentAction, componentPending] = useActionState(addBundleComponentAction, IDLE);
  return <Card className="p-4"><h3 className="text-[13px] font-bold">Bundles & Add-ons</h3><p className="mb-3 text-[11.5px] text-ink-500">Active offers are available to moderators. Add-on redemption is anchored to the procedure date.</p>
    <form action={bundleAction} className="mb-4 grid gap-2 md:grid-cols-4 md:items-end"><label className={label}>Name<input name="name" required className={field} /></label><label className={label}>Type<select name="bundleType" className={field}><option value="bundle">Bundle</option><option value="package">Package</option><option value="addon">Add-on</option></select></label><label className={label}>Specialty<select name="specialtyId" className={field}><option value="">All specialties</option>{data.doctors.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></label><label className={label}>Price<input name="price" type="number" min={0} step="0.01" required className={field} /></label><label className={label}>Starts<input name="startsOn" type="date" className={field} /></label><label className={label}>Expires<input name="expiresOn" type="date" className={field} /></label><input type="hidden" name="currency" value="EGP" /><label className="pb-2 text-[12px]"><input name="active" type="checkbox" defaultChecked /> Active</label><div><Save pending={bundlePending}>Add bundle</Save><Feedback state={bundleState} /></div></form>
    <form action={addonAction} className="mb-4 grid gap-2 md:grid-cols-4 md:items-end"><label className={label}>Reserved service<select name="triggerServiceRef" required className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Add-on service<select name="addonServiceRef" required className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Add-on price<input name="addonPrice" type="number" min={0} step="0.01" required className={field} /></label><label className={label}>Redeem within days<input name="redeemWithinDays" type="number" min={0} defaultValue={10} className={field} /></label><input type="hidden" name="active" value="true" /><div><Save pending={addonPending}>Add rule</Save><Feedback state={addonState} /></div></form>
    <form action={componentAction} className="mb-4 grid gap-2 border-y border-line-soft py-3 md:grid-cols-4 md:items-end"><label className={label}>Bundle<select name="bundleId" required className={field}><option value="">Choose bundle</option>{data.bundles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className={label}>Service<select name="serviceRef" required className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Treating doctor<select name="doctorId" required className={field} onChange={(e) => { const option = e.currentTarget.selectedOptions[0]; const target = e.currentTarget.form?.elements.namedItem("doctorName"); if (target instanceof HTMLInputElement) target.value = option?.dataset.name ?? ""; }}><option value="">Choose doctor</option>{data.doctors.doctors.map((d) => <option key={d.id} value={d.id} data-name={d.nameEn}>{d.nameEn}</option>)}</select><input type="hidden" name="doctorName" /></label><label className={label}>Quantity<input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className={field} /></label><label className={label}>Compensation<select name="compensationKind" className={field}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label><label className={label}>Compensation value<input name="compensationValue" required type="number" min="0" step="0.01" className={field} /></label><label className={label}>Basis<select name="compensationBasis" className={field}><option value="quoted_price">Quoted price</option><option value="net_after_consumables">Net after consumables</option></select></label><div><Save pending={componentPending}>Add bundle service</Save><Feedback state={componentState} /></div></form>
    <div className="grid gap-3 md:grid-cols-2"><div><h4 className="text-[12px] font-bold">Current bundles</h4>{data.bundles.map((b) => <div key={b.id} className="border-b py-1 text-[12px]"><div className="flex items-center justify-between"><span>{b.name} · {money(b.price)} {b.currency} · {b.expiresOn ?? "no expiry"}</span><ActiveToggle table="crm_financial_bundles" id={b.id} active={b.active} /></div>{data.bundleComponents.filter((c) => c.bundleId === b.id).map((c) => <div key={c.id} className="ps-3 text-[11px] text-ink-500">{c.serviceName} · {c.doctorName} · {c.compensationKind === "percentage" ? `${c.compensationValue}%` : `${money(c.compensationValue ?? 0)} EGP`}</div>)}</div>)}</div><div><h4 className="text-[12px] font-bold">Add-on rules</h4>{data.addonRules.map((a) => <div key={a.id} className="flex items-center justify-between border-b py-1 text-[12px]"><span>{a.triggerServiceName} → {a.addonServiceName}: {money(a.addonPrice)} EGP / {a.redeemWithinDays} days</span><ActiveToggle table="crm_service_addon_rules" id={a.id} active={a.active} /></div>)}</div></div>
  </Card>;
}

function StaffCommissions({ data }: { data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertStaffCommissionAction, IDLE);
  return <Card className="p-4"><h3 className="text-[13px] font-bold">Moderator / doctor commissions</h3><p className="mb-3 text-[11.5px] text-ink-500">Set commission by moderator, doctor, specialty, and service. Leave a dimension blank when it should apply broadly.</p><form action={action} className="grid gap-2 md:grid-cols-4 md:items-end"><label className={label}>Moderator<select name="moderatorId" className={field}><option value="">Any</option>{data.moderators.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className={label}>Doctor<select name="doctorId" className={field}><option value="">Any</option>{data.doctors.doctors.map((d) => <option key={d.id} value={d.id}>{d.nameEn}</option>)}</select></label><label className={label}>Specialty<select name="specialtyId" className={field}><option value="">Any</option>{data.doctors.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></label><label className={label}>Service<select name="serviceRef" className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Commission %<input name="commissionPct" type="number" min={0} max={100} step="0.01" required className={field} /></label><input type="hidden" name="active" value="true" /><div><Save pending={pending}>Add commission</Save><Feedback state={state} /></div></form><div className="mt-4">{data.staffCommissionRules.map((r) => <div key={r.id} className="flex items-center justify-between border-b py-1 text-[12px]"><span>{r.commissionPct}% · {r.serviceName ?? "all services"}</span><ActiveToggle table="crm_staff_commission_rules" id={r.id} active={r.active} /></div>)}</div></Card>;
}

function PaymentMethods({ data }: { data: FinancialSettingsData }) {
  return <Card className="p-4"><h3 className="text-[13px] font-bold">Payment Methods</h3><p className="mb-3 text-[11.5px] text-ink-500">Custom labels map to a canonical ledger method; deactivation preserves historical transactions.</p>{data.paymentMethodSettings.map((m) => <PaymentMethodForm key={m.id} method={m} data={data} />)}<PaymentMethodForm data={data} /></Card>;
}
function PaymentMethodForm({ method, data }: { method?: FinancialSettingsData["paymentMethodSettings"][number]; data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertPaymentMethodAction, IDLE);
  return <form action={action} className="flex flex-wrap items-end gap-2 border-b py-2">{method && <input type="hidden" name="id" value={method.id} />}<label className={label}>Key<input name="methodKey" required readOnly={Boolean(method)} defaultValue={method?.methodKey ?? ""} className={field} /></label><label className={label}>Display name<input name="displayName" required defaultValue={method?.displayName ?? ""} className={field} /></label><label className={label}>Ledger method<select name="ledgerMethod" defaultValue={method?.ledgerMethod ?? "other"} className={field}>{data.paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}</select></label><label className={label}>Order<input name="displayOrder" type="number" defaultValue={method?.displayOrder ?? data.paymentMethodSettings.length * 10 + 10} className={`${field} w-20`} /></label><label className="pb-2 text-[12px]"><input name="active" type="checkbox" defaultChecked={method?.active ?? true} /> Active</label><Save pending={pending}>{method ? "Save" : "Add method"}</Save><Feedback state={state} /></form>;
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
    <div>
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
    </div>
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
        {tab === "commissions" && <StaffCommissions data={data} />}
        {tab === "bundles" && <Bundles data={data} />}
        {tab === "payments" && <PaymentMethods data={data} />}
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
