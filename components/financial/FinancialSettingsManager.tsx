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
  duplicateConsumableRuleAction,
  duplicateDiscountRuleAction,
  duplicateDoctorCompRuleAction,
  type FinancialSettingsActionState,
} from "@/app/(crm)/financial/settings/actions";
import { Card } from "@/components/ui/Card";
import type { FinancialSettingsData, FinancialServiceSetting } from "@/lib/data/financialSettings";

const IDLE: FinancialSettingsActionState = {};
const field = "min-w-0 rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary disabled:opacity-60";
const label = "flex flex-col gap-1 text-[11px] font-semibold text-ink-500";

export type FinancialSettingsTab =
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

const TABS: Array<{ key: FinancialSettingsTab; label: string }> = [
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

function SettingsHero({ eyebrow, title, description, stats }: { eyebrow: string; title: string; description: string; stats: Array<{ label: string; value: number | string }> }) {
  return <div className="section-hero rounded-card p-5"><div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.17em]">{eyebrow}</div><div className="mt-2 text-[22px] font-black tracking-tight text-ink-950">{title}</div><p className="section-hero-muted mt-1 max-w-2xl text-[12px] leading-5">{description}</p><div className="mt-4 flex flex-wrap gap-2">{stats.map((stat) => <div key={stat.label} className="section-hero-stat rounded-control px-3 py-2"><div className="text-[16px] font-black text-ink-950">{stat.value}</div><div className="text-[9px] font-bold uppercase tracking-wide text-ink-500">{stat.label}</div></div>)}</div></div>;
}

function CheckboxPicker({ name, options }: { name: string; options: Array<{ value: string; label: string }> }) {
  return <div className="max-h-48 space-y-1 overflow-y-auto rounded-control border border-line-soft bg-panel p-2">{options.map((option) => <label key={option.value} className="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-[11.5px] text-ink-700 hover:bg-primary-soft"><input type="checkbox" name={name} value={option.value} /><span className="truncate">{option.label}</span></label>)}</div>;
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

function ClientPager({ page, pages, setPage }: { page: number; pages: number; setPage: (page: number) => void }) {
  if (pages <= 1) return null;
  return <div className="my-3 flex items-center justify-end gap-2 border-y border-line-soft bg-toolbar/60 py-2.5 text-[11.5px]"><span className="me-auto font-medium text-ink-500">Page {page} of {pages}</span><button disabled={page === 1} onClick={() => setPage(page - 1)} className="rounded-control border border-primary/30 bg-panel px-3 py-2 font-bold text-primary shadow-sm hover:bg-primary-soft disabled:opacity-40">Previous</button><button disabled={page === pages} onClick={() => setPage(page + 1)} className="rounded-control border border-primary bg-primary px-3 py-2 font-bold text-white shadow-sm hover:bg-primary-hover disabled:opacity-40">Next</button></div>;
}

function ServicePriceForm({ service }: { service: FinancialServiceSetting }) {
  const [state, action, pending] = useActionState(upsertServicePriceAction, IDLE);
  const complete = Boolean(service.id && service.basePrice > 0 && service.active);
  return (
    <form action={action} className={"rounded-xl border p-3.5 " + (complete ? "border-line bg-white" : "border-amber-200 bg-amber-50/45")}>
      {service.id && <input type="hidden" name="id" value={service.id} />}
      <input type="hidden" name="serviceId" value={service.serviceId ?? ""} />
      <input type="hidden" name="serviceName" value={service.serviceName} />
      <div className="mb-3 flex items-start justify-between gap-3 border-b border-line-faint pb-3">
        <div><div className="text-[13px] font-black text-ink-900">{service.serviceName}</div><div className="mt-0.5 text-[10.5px] text-ink-400">{service.specialtyName ? `Specific to ${service.specialtyName}` : "Available across all specialties"} {service.serviceCode ? `· ${service.serviceCode}` : ""}</div></div>
        <span className={"rounded-full px-2 py-1 text-[9.5px] font-black " + (complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800")}>{complete ? "READY" : "NEEDS INFO"}</span>
      </div>
      <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <label className={label}>Base price<input name="basePrice" type="number" min={0} step="0.01" defaultValue={service.basePrice} className={`${field} w-full`} /></label>
      <label className={label}>Currency<input name="currency" defaultValue={service.currency} className={`${field} w-full`} /></label>
      <label className={label}>Consumables<input name="defaultConsumablesCost" type="number" min={0} step="0.01" defaultValue={service.defaultConsumablesCost} className={`${field} w-full`} /></label>
      <label className={label}>Effective from<input name="effectiveFrom" type="date" defaultValue={service.effectiveFrom ?? ""} className={`${field} w-full`} /></label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4"><label className="flex items-center gap-1.5 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked={service.active} /> Active</label><Save pending={pending} /><Feedback state={state} /></div>
      </div>
    </form>
  );
}

function Services({ data }: { data: FinancialSettingsData }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "missing" | "ready">("all");
  const filtered = useMemo(() => data.services.filter((service) => {
    const complete = Boolean(service.id && service.basePrice > 0 && service.active);
    if (status === "missing" && complete) return false;
    if (status === "ready" && !complete) return false;
    return `${service.serviceName} ${service.specialtyName ?? "all specialties"}`.toLowerCase().includes(query.toLowerCase());
  }), [data.services, query, status]);
  const groups = useMemo(() => {
    const grouped = new Map<string, FinancialServiceSetting[]>();
    for (const service of filtered) {
      const key = service.specialtyName ?? "All specialties";
      grouped.set(key, [...(grouped.get(key) ?? []), service]);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);
  const ready = data.services.filter((service) => service.id && service.basePrice > 0 && service.active).length;
  return <div className="space-y-4">
    <div className="section-hero rounded-xl p-5"><div className="section-hero-eyebrow text-[10px] font-black uppercase tracking-[0.16em]">Pricing coverage</div><div className="mt-2 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"><div><h3 className="text-[22px] font-black text-ink-950">Service pricing</h3><p className="section-hero-muted mt-1 max-w-2xl text-[12px]">Every canonical service is grouped by specialty and clearly marked when pricing or activation is incomplete. Historical patient quotes remain frozen.</p></div><div className="flex gap-2"><div className="section-hero-stat rounded-lg px-3 py-2"><div className="text-[18px] font-black text-emerald-600">{ready}</div><div className="text-[9px] uppercase text-ink-500">Ready</div></div><div className="section-hero-stat rounded-lg px-3 py-2"><div className="text-[18px] font-black text-amber-600">{data.services.length - ready}</div><div className="text-[9px] uppercase text-ink-500">Needs info</div></div></div></div></div>
    <Card className="p-4"><div className="grid gap-2 sm:grid-cols-[1fr_180px]"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search service or specialty…" className={field} /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={field}><option value="all">All services</option><option value="missing">Needs information</option><option value="ready">Ready</option></select></div></Card>
    {groups.map(([specialty, services]) => <Card key={specialty} className="min-w-0 p-4"><div className="mb-3 flex items-center justify-between border-b border-line pb-3"><div><h4 className="text-[15px] font-black text-ink-900">{specialty}</h4><p className="mt-0.5 text-[10.5px] text-ink-400">{specialty === "All specialties" ? "Clinic-wide services" : "Services currently assigned to this specialty"}</p></div><span className="rounded-full bg-line-faint px-2.5 py-1 text-[10px] font-black text-ink-500">{services.length}</span></div><div className="grid min-w-0 gap-3">{services.map((service) => <ServicePriceForm key={`${service.serviceId ?? service.serviceName}-${service.id ?? ""}`} service={service} />)}</div></Card>)}
    {groups.length === 0 && <Card className="p-8 text-center text-[12px] text-ink-400">No services match this filter.</Card>}
  </div>;
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
      <ClientPager page={page} pages={pages} setPage={setPage} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-[12px]"><thead><tr className="border-b border-line-soft text-left text-[10px] uppercase text-ink-400"><th className="py-1.5">Scope</th><th>Moderator</th><th>Service</th><th>Max</th><th>Window</th><th>State</th><th>Actions</th></tr></thead><tbody>{data.discountRules.slice((page - 1) * 30, page * 30).map((r) => <DiscountRuleRow key={r.id} rule={r} data={data} />)}</tbody></table>
      </div>
      <ClientPager page={page} pages={pages} setPage={setPage} />
    </Card>
  );
}

function DiscountRuleRow({ rule: r, data }: { rule: FinancialSettingsData["discountRules"][number]; data: FinancialSettingsData }) {
  const [mode, setMode] = useState<"view" | "edit" | "duplicate">("view");
  const [state, action, pending] = useActionState(upsertDiscountRuleAction, IDLE);
  const [delState, delAction, delPending] = useActionState(deleteDiscountRuleAction, IDLE);
  const [duplicateState, duplicateAction, duplicatePending] = useActionState(duplicateDiscountRuleAction, IDLE);
  if (mode === "edit") return <tr className="border-b border-line-faint"><td colSpan={7} className="py-2"><form action={action} className="flex flex-wrap items-end gap-2">
    <input type="hidden" name="id" value={r.id} /><input type="hidden" name="scope" value={r.scope} />
    <input type="hidden" name="moderatorId" value={r.moderatorId ?? ""} /><input type="hidden" name="serviceId" value={r.serviceId ?? ""} /><input type="hidden" name="serviceName" value={r.serviceName ?? ""} />
    <label className={label}>Maximum discount %<input className={field} name="maxDiscountPct" type="number" min={0} max={100} step="0.01" defaultValue={r.maxDiscountPct} /></label>
    <label className={label}>Effective from<input className={field} name="effectiveFrom" type="date" defaultValue={r.effectiveFrom ?? ""} /></label>
    <label className={label}>Effective to<input className={field} name="effectiveTo" type="date" defaultValue={r.effectiveTo ?? ""} /></label>
    <label className="pb-2 text-[12px]"><input name="active" type="checkbox" defaultChecked={r.active} /> Active</label>
    <Save pending={pending} /><button type="button" onClick={() => setMode("view")} className="h-8 px-2 text-[12px]">Cancel</button><Feedback state={state} />
  </form></td></tr>;
  if (mode === "duplicate") return <tr className="border-b border-line-faint"><td colSpan={7} className="py-3"><form action={duplicateAction} className="rounded-control border border-primary/20 bg-primary-soft/20 p-3"><input type="hidden" name="sourceId" value={r.id} /><div className="mb-3"><div className="text-[13px] font-black text-ink-900">Duplicate this {r.maxDiscountPct}% privilege</div><p className="text-[11px] text-ink-500">Choose moderators, services, or both. Selecting both creates every selected combination.</p></div><div className="grid gap-3 md:grid-cols-2"><label className={label}>Moderators<CheckboxPicker name="targetModeratorRef" options={data.moderators.map((m) => ({ value: `${m.id}::${m.name}`, label: m.name }))} /></label><label className={label}>Services<CheckboxPicker name="targetServiceRef" options={data.services.map((s) => ({ value: serviceRef(s), label: s.serviceName }))} /></label></div><div className="mt-3 flex flex-wrap items-center gap-2"><Save pending={duplicatePending}>Duplicate to selected</Save><button type="button" onClick={() => setMode("view")} className="h-8 px-2 text-[12px]">Cancel</button><Feedback state={duplicateState} /></div></form></td></tr>;
  return <tr className="border-b border-line-faint"><td className="py-1.5">{r.scope}</td><td>{r.moderatorName ?? "-"}</td><td>{r.serviceName ?? r.serviceId ?? "-"}</td><td>{r.maxDiscountPct}%</td><td>{r.effectiveFrom ?? "now"} - {r.effectiveTo ?? "open"}</td><td>{r.active ? "Active" : "Off"}</td><td className="flex gap-2 py-1.5"><button type="button" onClick={() => setMode("edit")} className="font-semibold text-primary">Edit</button><button type="button" onClick={() => setMode("duplicate")} className="font-semibold text-primary">Duplicate</button><form action={delAction}><input type="hidden" name="id" value={r.id} /><button disabled={delPending} className="font-semibold text-red-600">{delPending ? "Deleting..." : "Delete"}</button></form><Feedback state={delState} /></td></tr>;
}

function ConsumableDefaultRow({ item, data }: { item: FinancialSettingsData["serviceConsumableDefaults"][number]; data: FinancialSettingsData }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(duplicateConsumableRuleAction, IDLE);
  return <div className="mt-1 rounded-control border border-line-faint bg-panel/70 px-2.5 py-2 text-[11.5px] text-ink-600"><div className="flex flex-wrap items-center justify-between gap-2"><span>{item.description} · <b>{money(item.totalCost)} EGP</b> {item.active ? "" : "(inactive)"}</span><button type="button" onClick={() => setOpen((value) => !value)} className="font-bold text-primary">Duplicate</button></div>{open && <form action={action} className="mt-2 border-t border-line-faint pt-2"><input type="hidden" name="sourceId" value={item.id} /><p className="mb-2 text-[10.5px] text-ink-500">Copy quantity, unit cost and active state to one or more services.</p><CheckboxPicker name="targetServiceRef" options={data.services.map((service) => ({ value: serviceRef(service), label: service.serviceName }))} /><div className="mt-2 flex flex-wrap items-center gap-2"><Save pending={pending}>Duplicate to services</Save><button type="button" onClick={() => setOpen(false)} className="h-8 px-2 text-[11px]">Cancel</button><Feedback state={state} /></div></form>}</div>;
}

function Consumables({ data }: { data: FinancialSettingsData }) {
  const [page, setPage] = useState(1);
  const [componentState, componentAction, componentPending] = useActionState(upsertConsumableComponentAction, IDLE);
  const [defaultState, defaultAction, defaultPending] = useActionState(upsertServiceConsumableDefaultAction, IDLE);
  const servicesMissing = data.services.filter((service) => !data.serviceConsumableDefaults.some((item) => item.serviceId ? item.serviceId === service.serviceId : item.serviceName === service.serviceName)).length;
  return (
    <div className="space-y-4">
      <SettingsHero eyebrow="Cost foundation" title="Consumables by service" description="Build the reusable item catalog first, then assign realistic quantities and costs to each service. Lead-specific adjustments never rewrite these defaults." stats={[{ label: "Components", value: data.consumableComponents.length }, { label: "Service defaults", value: data.serviceConsumableDefaults.length }, { label: "Services missing setup", value: servicesMissing }]} />
      <div className="grid gap-3 xl:grid-cols-2">
      <form action={componentAction} className="rounded-card border border-line-soft bg-white p-4">
        <div className="mb-3"><div className="text-[11px] font-black uppercase tracking-wide text-primary">Step 1</div><h3 className="text-[16px] font-black text-ink-950">Create a reusable component</h3><p className="text-[11.5px] text-ink-500">One canonical unit cost, reusable across services.</p></div>
        <div className="flex flex-wrap items-end gap-2">
        <label className={label}>Component<input name="name" required className={`${field} min-w-[180px]`} /></label>
        <label className={label}>Unit cost<input name="unitCost" type="number" min={0} step="0.01" required className={`${field} w-28`} /></label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked /> Active</label>
        <Save pending={componentPending}>Add component</Save><Feedback state={componentState} />
        </div>
      </form>
      <form action={defaultAction} className="rounded-card border border-line-soft bg-white p-4">
        <div className="mb-3"><div className="text-[11px] font-black uppercase tracking-wide text-primary">Step 2</div><h3 className="text-[16px] font-black text-ink-950">Assign a service default</h3><p className="text-[11.5px] text-ink-500">The total is quantity × unit cost and feeds profitability.</p></div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
        <label className={label}>Service<select name="serviceRef" required className={field}><ServiceOptions services={data.services} /></select></label>
        <label className={label}>Description<input name="description" required className={field} /></label>
        <label className={label}>Qty<input name="quantity" type="number" min={0.001} step="0.001" defaultValue={1} className={field} /></label>
        <label className={label}>Unit cost<input name="unitCost" type="number" min={0} step="0.01" required className={field} /></label>
        <div className="flex items-center gap-2"><input type="hidden" name="active" value="true" /><Save pending={defaultPending}>Add default</Save><Feedback state={defaultState} /></div>
        </div>
      </form>
      </div>
      <Card className="p-4"><div className="mb-4"><h4 className="mb-2 text-[14px] font-black text-ink-900">Component catalog</h4><div className="flex flex-wrap gap-2">{data.consumableComponents.map((c) => <div key={c.id} className="rounded-control border border-line-soft bg-panel px-3 py-2 text-[12px]"><span className="font-bold text-ink-900">{c.name}</span><span className="ms-2 text-ink-500">{money(c.unitCost)} EGP {c.active ? "" : "· off"}</span></div>)}</div></div>
      <div className="mb-2 flex items-end justify-between gap-2"><div><h4 className="text-[14px] font-black text-ink-900">Service coverage</h4><p className="text-[11px] text-ink-500">Amber services still need a cost setup.</p></div><span className="rounded-pill bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">{servicesMissing} missing</span></div>
      <ClientPager page={page} pages={Math.ceil(data.services.length / 30)} setPage={setPage} />
      <div className="grid gap-2 md:grid-cols-2">
        {data.services.slice((page - 1) * 30, page * 30).map((service) => {
          const defaults = data.serviceConsumableDefaults.filter((item) => item.serviceId ? item.serviceId === service.serviceId : item.serviceName === service.serviceName);
          return <div key={serviceRef(service)} className={`min-w-0 rounded-control border p-3 ${defaults.length ? "border-line-soft bg-white" : "border-amber-200 bg-amber-50"}`}><div className="text-[12px] font-black text-ink-900">{service.serviceName}</div>{defaults.length ? defaults.map((item) => <ConsumableDefaultRow key={item.id} item={item} data={data} />) : <div className="mt-1 text-[11.5px] font-bold text-amber-700">Needs consumables setup</div>}</div>;
        })}
      </div>
      <ClientPager page={page} pages={Math.ceil(data.services.length / 30)} setPage={setPage} />
      <div className="mt-5 border-t border-line-soft pt-4"><ExternalDefaults data={data} /></div>
      </Card>
    </div>
  );
}

function Bundles({ data }: { data: FinancialSettingsData }) {
  const [bundleState, bundleAction, bundlePending] = useActionState(upsertBundleAction, IDLE);
  const [addonState, addonAction, addonPending] = useActionState(upsertAddonRuleAction, IDLE);
  const [componentState, componentAction, componentPending] = useActionState(addBundleComponentAction, IDLE);
  return <div className="space-y-4">
    <SettingsHero eyebrow="Offer builder" title="Bundles, packages and add-ons" description="Offers and conditional add-ons are different tools. Create the offer, attach its services and compensation, or define a separate post-procedure add-on window." stats={[{ label: "Offers", value: data.bundles.length }, { label: "Offer services", value: data.bundleComponents.length }, { label: "Add-on rules", value: data.addonRules.length }]} />
    <div className="grid gap-3 xl:grid-cols-3">
      <details open className="rounded-card border border-line-soft bg-white p-4"><summary className="cursor-pointer text-[15px] font-black text-ink-950">1 · Create an offer</summary><p className="mt-1 text-[11px] text-ink-500">Define audience, price, and availability.</p><form action={bundleAction} className="mt-3 grid gap-2"><label className={label}>Offer name<input name="name" required className={field} /></label><div className="grid grid-cols-2 gap-2"><label className={label}>Type<select name="bundleType" className={field}><option value="bundle">Bundle</option><option value="package">Package</option><option value="addon">Add-on</option></select></label><label className={label}>Price (EGP)<input name="price" type="number" min={0} step="0.01" required className={field} /></label></div><label className={label}>Specialty scope<select name="specialtyId" className={field}><option value="">All specialties</option>{data.doctors.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></label><div className="grid grid-cols-2 gap-2"><label className={label}>Starts<input name="startsOn" type="date" className={field} /></label><label className={label}>Expires<input name="expiresOn" type="date" className={field} /></label></div><input type="hidden" name="currency" value="EGP" /><label className="text-[12px]"><input name="active" type="checkbox" defaultChecked /> Available immediately</label><div><Save pending={bundlePending}>Create offer</Save><Feedback state={bundleState} /></div></form></details>
      <details className="rounded-card border border-line-soft bg-white p-4"><summary className="cursor-pointer text-[15px] font-black text-ink-950">2 · Add a service to an offer</summary><p className="mt-1 text-[11px] text-ink-500">Every service has its own treating doctor and payout rule.</p><form action={componentAction} className="mt-3 grid gap-2"><label className={label}>Offer<select name="bundleId" required className={field}><option value="">Choose offer</option>{data.bundles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label className={label}>Service<select name="serviceRef" required className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Treating doctor<select name="doctorId" required className={field} onChange={(e) => { const option = e.currentTarget.selectedOptions[0]; const target = e.currentTarget.form?.elements.namedItem("doctorName"); if (target instanceof HTMLInputElement) target.value = option?.dataset.name ?? ""; }}><option value="">Choose doctor</option>{data.doctors.doctors.map((d) => <option key={d.id} value={d.id} data-name={d.nameEn}>{d.nameEn}</option>)}</select><input type="hidden" name="doctorName" /></label><div className="grid grid-cols-2 gap-2"><label className={label}>Quantity<input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className={field} /></label><label className={label}>Payout type<select name="compensationKind" className={field}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label></div><label className={label}>Payout value<input name="compensationValue" required type="number" min="0" step="0.01" className={field} /></label><label className={label}>Calculated from<select name="compensationBasis" className={field}><option value="quoted_price">Patient quoted price</option><option value="net_after_consumables">Net after consumables</option></select></label><div><Save pending={componentPending}>Attach service</Save><Feedback state={componentState} /></div></form></details>
      <details className="rounded-card border border-line-soft bg-white p-4"><summary className="cursor-pointer text-[15px] font-black text-ink-950">Create a conditional add-on</summary><p className="mt-1 text-[11px] text-ink-500">Offer service B after service A within a fixed window.</p><form action={addonAction} className="mt-3 grid gap-2"><label className={label}>After this reserved service<select name="triggerServiceRef" required className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Offer this add-on<select name="addonServiceRef" required className={field}><ServiceOptions services={data.services} /></select></label><div className="grid grid-cols-2 gap-2"><label className={label}>Add-on price<input name="addonPrice" type="number" min={0} step="0.01" required className={field} /></label><label className={label}>Valid for days<input name="redeemWithinDays" type="number" min={0} defaultValue={10} className={field} /></label></div><input type="hidden" name="active" value="true" /><div><Save pending={addonPending}>Create add-on rule</Save><Feedback state={addonState} /></div></form></details>
    </div>
    <div className="grid gap-3 xl:grid-cols-2"><Card className="p-4"><h4 className="mb-3 text-[15px] font-black text-ink-950">Current offers</h4><div className="space-y-2">{data.bundles.map((b) => <div key={b.id} className="rounded-control border border-line-soft p-3 text-[12px]"><div className="flex items-start justify-between gap-2"><div><b className="text-[13px] text-ink-950">{b.name}</b><div className="mt-0.5 text-ink-500">{money(b.price)} {b.currency} · {b.expiresOn ? `until ${b.expiresOn}` : "no expiry"}</div></div><ActiveToggle table="crm_financial_bundles" id={b.id} active={b.active} /></div>{data.bundleComponents.filter((c) => c.bundleId === b.id).map((c) => <div key={c.id} className="mt-2 border-t border-line-faint pt-2 text-[11px] text-ink-600">{c.serviceName} · {c.doctorName} · {c.compensationKind === "percentage" ? `${c.compensationValue}%` : `${money(c.compensationValue ?? 0)} EGP`}</div>)}</div>)}</div></Card><Card className="p-4"><h4 className="mb-3 text-[15px] font-black text-ink-950">Conditional add-ons</h4><div className="space-y-2">{data.addonRules.map((a) => <div key={a.id} className="flex items-start justify-between gap-3 rounded-control border border-line-soft p-3 text-[12px]"><div><b>{a.triggerServiceName}</b><div className="my-1 text-primary">↓ unlocks</div><b>{a.addonServiceName}</b><div className="mt-1 text-ink-500">{money(a.addonPrice)} EGP · valid {a.redeemWithinDays} days</div></div><ActiveToggle table="crm_service_addon_rules" id={a.id} active={a.active} /></div>)}</div></Card></div>
  </div>;
}

function StaffCommissions({ data }: { data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertStaffCommissionAction, IDLE);
  return <div className="space-y-4"><SettingsHero eyebrow="Commission logic" title="Moderator commissions with visible scope" description="Start broad only when you mean broad. Selecting a moderator, doctor, specialty, or service narrows exactly where the percentage applies." stats={[{ label: "Rules", value: data.staffCommissionRules.length }, { label: "Moderators", value: data.moderators.length }]} /><Card className="p-4"><div className="mb-3"><h3 className="text-[16px] font-black text-ink-950">Create a commission rule</h3><p className="text-[11.5px] text-ink-500">Any blank dimension means “all” for that dimension.</p></div><form action={action} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5 xl:items-end"><label className={label}>Moderator<select name="moderatorId" className={field}><option value="">All moderators</option>{data.moderators.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label className={label}>Doctor<select name="doctorId" className={field}><option value="">All doctors</option>{data.doctors.doctors.map((d) => <option key={d.id} value={d.id}>{d.nameEn}</option>)}</select></label><label className={label}>Specialty<select name="specialtyId" className={field}><option value="">All specialties</option>{data.doctors.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></label><label className={label}>Service<select name="serviceRef" className={field}><ServiceOptions services={data.services} /></select></label><label className={label}>Commission %<input name="commissionPct" type="number" min={0} max={100} step="0.01" required className={field} /></label><input type="hidden" name="active" value="true" /><div><Save pending={pending}>Create rule</Save><Feedback state={state} /></div></form></Card><div className="grid gap-2 md:grid-cols-2">{data.staffCommissionRules.map((r) => <Card key={r.id} className="p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[22px] font-black text-ink-950">{r.commissionPct}%</div><div className="mt-1 text-[11px] text-ink-500">Scope: {r.serviceName ?? "all services"}</div></div><ActiveToggle table="crm_staff_commission_rules" id={r.id} active={r.active} /></div></Card>)}</div></div>;
}

function PaymentMethods({ data }: { data: FinancialSettingsData }) {
  return <Card className="p-4"><h3 className="text-[13px] font-bold">Payment Methods</h3><p className="mb-3 text-[11.5px] text-ink-500">Custom labels map to a canonical ledger method; deactivation preserves historical transactions.</p>{data.paymentMethodSettings.map((m) => <PaymentMethodForm key={m.id} method={m} data={data} />)}<PaymentMethodForm data={data} /></Card>;
}
function PaymentMethodForm({ method, data }: { method?: FinancialSettingsData["paymentMethodSettings"][number]; data: FinancialSettingsData }) {
  const [state, action, pending] = useActionState(upsertPaymentMethodAction, IDLE);
  return <form action={action} className="flex flex-wrap items-end gap-2 border-b py-2">{method && <input type="hidden" name="id" value={method.id} />}<label className={label}>Key<input name="methodKey" required readOnly={Boolean(method)} defaultValue={method?.methodKey ?? ""} className={field} /></label><label className={label}>Display name<input name="displayName" required defaultValue={method?.displayName ?? ""} className={field} /></label><label className={label}>Ledger method<select name="ledgerMethod" defaultValue={method?.ledgerMethod ?? "other"} className={field}>{data.paymentMethods.map((m) => <option key={m} value={m}>{m}</option>)}</select></label><label className={label}>Order<input name="displayOrder" type="number" defaultValue={method?.displayOrder ?? data.paymentMethodSettings.length * 10 + 10} className={`${field} w-20`} /></label><label className="pb-2 text-[12px]"><input name="active" type="checkbox" defaultChecked={method?.active ?? true} /> Active</label><Save pending={pending}>{method ? "Save" : "Add method"}</Save><Feedback state={state} /></form>;
}

function DoctorCompRuleCard({ rule, data }: { rule: FinancialSettingsData["doctorCompRules"][number]; data: FinancialSettingsData }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(duplicateDoctorCompRuleAction, IDLE);
  return <div className="rounded-control border border-line-soft bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[12px] font-black text-ink-900">{rule.serviceName ?? rule.serviceId ?? "All services"}</div><div className="mt-1 text-[11px] text-ink-500">{rule.kind === "fixed" ? `${money(rule.value)} EGP fixed` : `${rule.value}%`} · based on {rule.basis.replaceAll("_", " ")}</div></div><div className="flex items-center gap-2"><span className={`text-[10px] font-bold ${rule.active ? "text-emerald-700" : "text-ink-400"}`}>{rule.active ? "Active" : "Off"}</span><button type="button" onClick={() => setOpen((value) => !value)} className="text-[11px] font-bold text-primary">Duplicate</button></div></div>{open && <form action={action} className="mt-3 border-t border-line-faint pt-3"><input type="hidden" name="sourceId" value={rule.id} /><p className="mb-2 text-[10.5px] text-ink-500">Choose doctors, services, or both. A blank group keeps that dimension from the original rule.</p><div className="grid gap-3 md:grid-cols-2"><label className={label}>Doctors<CheckboxPicker name="targetDoctorRef" options={data.doctors.doctors.map((doctor) => ({ value: `${doctor.id}::${doctor.nameEn}`, label: doctor.nameEn }))} /></label><label className={label}>Services<CheckboxPicker name="targetServiceRef" options={data.services.map((service) => ({ value: serviceRef(service), label: service.serviceName }))} /></label></div><div className="mt-3 flex flex-wrap items-center gap-2"><Save pending={pending}>Duplicate to selected</Save><button type="button" onClick={() => setOpen(false)} className="h-8 px-2 text-[11px]">Cancel</button><Feedback state={state} /></div></form>}</div>;
}

function Doctors({ data }: { data: FinancialSettingsData }) {
  const [ruleState, ruleAction, rulePending] = useActionState(upsertDoctorCompRuleAction, IDLE);
  const [doctorState, doctorAction, doctorPending] = useActionState(addFinancialDoctorAction, IDLE);
  const doctorsWithRules = data.doctors.doctors.map((doctor) => ({ doctor, rules: data.doctorCompRules.filter((rule) => rule.doctorId === doctor.id) }));
  return (
    <div className="space-y-4">
      <SettingsHero eyebrow="Clinical payout rules" title="Doctor compensation, grouped by doctor" description="Doctors come from the booking catalog. Each card below shows the exact services and calculation basis that apply to one doctor." stats={[{ label: "Doctors", value: data.doctors.doctors.length }, { label: "Rules", value: data.doctorCompRules.length }, { label: "Doctors without rules", value: doctorsWithRules.filter((item) => item.rules.length === 0).length }]} />
    <Card className="p-4">
      <h3 className="mb-1 text-[16px] font-black text-ink-900">Setup actions</h3>
      <p className="mb-3 text-[11.5px] text-ink-500">Adding a doctor here creates an inactive booking-catalog entry. Adding a payout rule does not change scheduling availability.</p>
      {!data.doctors.configured && <p className="mb-3 rounded-control border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">Booking/Admin doctor source is not configured.</p>}
      <details className="mb-3 rounded-control border border-line-soft bg-panel p-3"><summary className="cursor-pointer text-[13px] font-black text-ink-800">Add a doctor to the catalog</summary><form action={doctorAction} className="mt-3 grid gap-2 md:grid-cols-5 md:items-end">
        <label className={label}>Name EN<input name="nameEn" required className={field} /></label>
        <label className={label}>Title<input name="titleEn" className={field} /></label>
        <label className={label}>Specialty<select name="specialtyId" required className={field}><option value="">Choose</option>{data.doctors.specialties.map((s) => <option key={s.id} value={s.id}>{s.nameEn}</option>)}</select></label>
        <label className={label}>Consultation fee<input name="consultationFee" type="number" min={0} step="0.01" className={field} /></label>
        <div className="flex items-center gap-2"><Save pending={doctorPending}>Add inactive doctor</Save><Feedback state={doctorState} /></div>
      </form></details>
      <details open className="rounded-control border border-primary/20 bg-primary-soft/20 p-3"><summary className="cursor-pointer text-[13px] font-black text-ink-800">Create a compensation rule</summary><form action={ruleAction} className="mt-3 grid gap-2 md:grid-cols-4 md:items-end">
        <label className={label}>Doctor<select name="doctorId" required className={field}><option value="">Choose doctor</option>{data.doctors.doctors.map((d) => <option key={d.id} value={d.id}>{d.nameEn}{d.active ? "" : " (inactive)"}</option>)}</select></label>
        <label className={label}>Doctor name<input name="doctorName" className={field} placeholder="Optional freeze label" /></label>
        <label className={label}>Service<select name="serviceRef" className={field}><ServiceOptions services={data.services} /></select></label>
        <label className={label}>Kind<select name="kind" className={field}><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></label>
        <label className={label}>Value<input name="value" type="number" min={0} step="0.01" required className={field} /></label>
        <label className={label}>Basis<select name="basis" className={field}><option value="quoted_price">Quoted price</option><option value="net_after_consumables">Net after consumables</option></select></label>
        <label className="flex items-center gap-1.5 pb-2 text-[12px] text-ink-700"><input type="checkbox" name="active" defaultChecked /> Active</label>
        <div className="flex items-center gap-2"><Save pending={rulePending}>Add rule</Save><Feedback state={ruleState} /></div>
      </form></details>
    </Card>
      <div className="grid gap-3 xl:grid-cols-2">{doctorsWithRules.map(({ doctor, rules }) => <Card key={doctor.id} className={`min-w-0 p-4 ${rules.length ? "" : "border-amber-200 bg-amber-50/40"}`}><div className="flex items-start justify-between gap-3"><div><h3 className="text-[16px] font-black text-ink-950">{doctor.nameEn}</h3><div className="mt-1 text-[11px] text-ink-500">{doctor.active ? "Active in booking catalog" : "Inactive / not bookable"}</div></div><span className={`rounded-pill px-2 py-1 text-[10px] font-black ${rules.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{rules.length ? `${rules.length} rule${rules.length === 1 ? "" : "s"}` : "Needs payout rule"}</span></div><div className="mt-3 space-y-2">{rules.map((rule) => <DoctorCompRuleCard key={rule.id} rule={rule} data={data} />)}</div></Card>)}</div>
    </div>
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

export function FinancialSettingsManager({ data, initialTab }: { data: FinancialSettingsData; initialTab?: string }) {
  const validInitial = TABS.some((item) => item.key === initialTab) ? initialTab as FinancialSettingsTab : "overview";
  const [tab, setTab] = useState<FinancialSettingsTab>(validInitial);
  function selectTab(next: FinancialSettingsTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("financeTab");
    else url.searchParams.set("financeTab", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-panel p-4"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Financial control center</div><div className="mt-1 text-[20px] font-black text-ink-900">Pricing, privileges and cost rules</div><p className="mt-1 text-[11.5px] text-ink-500">Configure the inputs once; lead payments, dashboards and finalized reports all use the same rules.</p></div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[230px_1fr]">
      <aside className="flex flex-row flex-nowrap gap-1 overflow-x-auto rounded-xl border border-line bg-panel p-2 lg:sticky lg:top-3 lg:h-fit lg:flex-col lg:overflow-visible">
        {TABS.map((t) => <button type="button" aria-pressed={tab === t.key} key={t.key} onClick={() => selectTab(t.key)} className={"shrink-0 rounded-control px-3 py-2 text-left text-[12.5px] font-semibold lg:shrink " + (tab === t.key ? "bg-primary-soft text-primary" : "text-ink-600 hover:bg-line-faint/60")}>{t.label}</button>)}
      </aside>
      <div className="min-w-0">
        {tab === "overview" && <Card className="p-4"><h3 className="mb-2 text-[13px] font-bold text-ink-900">Financial Settings Overview</h3><div className="grid gap-2 sm:grid-cols-3"><Stat label="Canonical services" value={String(data.services.length)} /><Stat label="Pricing rows" value={String(data.services.filter((s) => s.id).length)} /><Stat label="Discount rules" value={String(data.discountRules.length)} /><Stat label="Admin doctors" value={String(data.doctors.doctors.length)} /><Stat label="Doctor comp rules" value={String(data.doctorCompRules.length)} /><Stat label="Default cost templates" value={String(data.serviceConsumableDefaults.length + data.externalCostDefaults.length)} /></div></Card>}
        {tab === "services" && <Services data={data} />}
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
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-control border border-line-soft p-3"><div className="text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">{label}</div><div className="mt-1 text-[14px] font-bold text-ink-900">{value}</div></div>;
}
