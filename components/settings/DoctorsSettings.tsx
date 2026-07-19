"use client";
/* eslint-disable @next/next/no-img-element */

import { useActionState, useEffect, useMemo, useState } from "react";
import { deleteDoctorAction, saveDoctorAction, type DoctorActionState } from "@/app/(crm)/settings/doctor-actions";
import type { CrmDoctorCatalogRow, CrmDoctorCatalogSnapshot } from "@/lib/booking/doctors";
import { EmptyState } from "@/components/ui/EmptyState";

const IDLE: DoctorActionState = { ok: false };
const field = "w-full rounded-control border border-line-soft bg-white px-3 py-2.5 text-[13px] text-ink-800 outline-none focus:border-primary disabled:opacity-60";
const label = "flex flex-col gap-1.5 text-[12px] font-bold text-ink-600";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "DR";
}

function StatusPill({ tone, children }: { tone: "green" | "blue" | "gray"; children: React.ReactNode }) {
  const colors = tone === "green" ? "bg-emerald-50 text-emerald-700" : tone === "blue" ? "bg-primary-soft text-primary" : "bg-line-faint text-ink-500";
  return <span className={`rounded-pill px-2.5 py-1 text-[10.5px] font-black ${colors}`}>{children}</span>;
}

function DoctorEditor({ snapshot, doctor, onClose }: { snapshot: CrmDoctorCatalogSnapshot; doctor?: CrmDoctorCatalogRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(saveDoctorAction, IDLE);
  useEffect(() => { if (state.ok) onClose(); }, [onClose, state.ok]);
  return (
    <div className="crm-doctor-modal-backdrop" role="presentation">
      <section className="crm-doctor-modal" role="dialog" aria-modal="true" aria-labelledby="crm-doctor-editor-title">
        <header className="crm-doctor-modal-header">
          <div><p>Shared doctor catalog</p><h3 id="crm-doctor-editor-title">{doctor ? "Edit doctor" : "Add doctor"}</h3><span>CRM is the source of truth for Admin and online booking.</span></div>
          <button type="button" onClick={onClose} aria-label="Close doctor editor">×</button>
        </header>
        <form action={action} className="crm-doctor-modal-body">
          {doctor && (
            <input type="hidden" name="id" value={doctor.id}/>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>Name (English) *<input required name="nameEn" defaultValue={doctor?.nameEn} className={field}/></label>
            <label className={label}>Name (Arabic)<input name="nameAr" defaultValue={doctor?.nameAr} dir="rtl" className={field}/></label>
            <label className={label}>Specialty *
              <select required name="specialtyId" defaultValue={doctor?.specialtyId ?? ""} className={field}>
                <option value="">Choose specialty</option>
                {snapshot.specialties.filter((specialty) => specialty.active || specialty.id === doctor?.specialtyId).map((specialty) => <option key={specialty.id} value={specialty.id}>{specialty.nameEn}{specialty.active ? "" : " (inactive)"}</option>)}
              </select>
              <small className="font-normal text-ink-400">This list contains specialties only. Branches are selected separately below.</small>
            </label>
            <label className={label}>Consultation fee (EGP)<input type="number" min="0" step="0.01" name="consultationFee" defaultValue={doctor?.consultationFee ?? ""} className={field}/></label>
            <label className={label}>Title (English) *<input required name="titleEn" defaultValue={doctor?.titleEn} className={field}/></label>
            <label className={label}>Title (Arabic)<input name="titleAr" defaultValue={doctor?.titleAr} dir="rtl" className={field}/></label>
          </div>

          <fieldset className="crm-doctor-fieldset">
            <legend>Branches *</legend>
            <p>Choose every branch where this doctor works. One branch becomes a fixed disabled field in booking; multiple branches become a dropdown.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {snapshot.branches.filter((branch) => branch.active || doctor?.branchIds.includes(branch.id)).map((branch) => (
                <label key={branch.id} className="crm-doctor-branch-option">
                  <input type="checkbox" name="branchIds" value={branch.id} defaultChecked={doctor?.branchIds.includes(branch.id)}/>
                  <span aria-hidden="true">✓</span>
                  <b>{branch.nameEn}</b>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 md:grid-cols-2">
            <label className={label}>Short bio (English)<textarea name="bioEn" defaultValue={doctor?.bioEn} rows={3} className={field}/></label>
            <label className={label}>Short bio (Arabic)<textarea name="bioAr" defaultValue={doctor?.bioAr} rows={3} dir="rtl" className={field}/></label>
            <label className={label}>Detailed description (English)<textarea name="descriptionEn" defaultValue={doctor?.descriptionEn} rows={4} className={field}/></label>
            <label className={label}>Detailed description (Arabic)<textarea name="descriptionAr" defaultValue={doctor?.descriptionAr} rows={4} dir="rtl" className={field}/></label>
            <label className={label}>Photo URL<input type="url" name="photoUrl" defaultValue={doctor?.photoUrl} placeholder="https://…" className={field}/></label>
            <label className={label}>Doctor video URL<input type="url" name="videoUrl" defaultValue={doctor?.videoUrl} placeholder="Instagram, YouTube, TikTok…" className={field}/></label>
            <label className={label}>Display order<input type="number" name="displayOrder" defaultValue={doctor?.displayOrder ?? snapshot.doctors.length + 1} className={field}/></label>
          </div>

          <section className="crm-doctor-rules">
            <label><input type="checkbox" name="active" defaultChecked={doctor?.active ?? true}/><span><b>Active</b><small>Available throughout CRM and scheduling. Inactive doctors stay preserved for history.</small></span></label>
            <label><input type="checkbox" name="showOnBookingWebsite" defaultChecked={doctor?.showOnBookingWebsite ?? true}/><span><b>Show on Booking Website</b><small>Doctor can appear publicly only when active and assigned to a visible schedule.</small></span></label>
            <label><input type="checkbox" name="featuredOnHomepage" defaultChecked={doctor?.featuredOnHomepage ?? false}/><span><b>Featured on homepage</b><small>Eligible for the homepage doctor selection when publicly available.</small></span></label>
          </section>

          {state.error && <div className="crm-doctor-error" role="alert">{state.error}</div>}
          <footer className="crm-doctor-modal-footer"><button type="button" onClick={onClose}>Cancel</button><button disabled={pending} className="is-primary">{pending ? "Saving…" : "Save doctor"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function DeleteDoctor({ doctor }: { doctor: CrmDoctorCatalogRow }) {
  const [state, action, pending] = useActionState(deleteDoctorAction, IDLE);
  return <form action={action} onSubmit={(event) => { if (!window.confirm(`Delete ${doctor.nameEn}? Deactivating is safer when historical records exist.`)) event.preventDefault(); }}><input type="hidden" name="id" value={doctor.id}/><button disabled={pending} className="crm-doctor-delete" aria-label={`Delete ${doctor.nameEn}`}>{pending ? "…" : "Delete"}</button>{state.error && <span className="crm-doctor-floating-error">{state.error}</span>}</form>;
}

export function DoctorsSettings({ snapshot }: { snapshot: CrmDoctorCatalogSnapshot }) {
  const [editing, setEditing] = useState<CrmDoctorCatalogRow | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive" | "hidden">("all");
  const doctors = useMemo(() => snapshot.doctors.filter((doctor) => {
    const text = `${doctor.nameEn} ${doctor.nameAr} ${doctor.specialtyName}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (status === "active" && !doctor.active) return false;
    if (status === "inactive" && doctor.active) return false;
    if (status === "hidden" && doctor.showOnBookingWebsite) return false;
    return true;
  }), [query, snapshot.doctors, status]);
  const branchById = new Map(snapshot.branches.map((branch) => [branch.id, branch]));

  if (!snapshot.configured) return <EmptyState title="Shared doctor catalog is not configured" hint="Add the booking Supabase server credentials to manage canonical doctors."/>;
  if (!snapshot.migrationReady) return <EmptyState title="Doctor catalog migration required" hint="Apply booking migration 023_crm_doctor_catalog.sql before managing doctors."/>;

  return <div className="space-y-5">
    <header className="crm-doctor-hero">
      <div><p>Single source of truth</p><h2>Doctors</h2><span>Manage the doctor profiles, specialties, branches, visibility, and active state used by CRM, Admin, and online booking.</span></div>
      <div className="crm-doctor-hero-stats"><span><b>{snapshot.doctors.length}</b>Total</span><span><b>{snapshot.doctors.filter((doctor) => doctor.active).length}</b>Active</span><span><b>{snapshot.doctors.filter((doctor) => doctor.showOnBookingWebsite).length}</b>Shown online</span></div>
    </header>
    <section className="crm-doctor-toolbar">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search doctor or specialty…" aria-label="Search doctors"/>
      <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Filter doctors"><option value="all">All doctors</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="hidden">Hidden from booking</option></select>
      <button type="button" onClick={() => setEditing("new")}>＋ Add doctor</button>
    </section>
    <div className="crm-doctor-grid">
      {doctors.map((doctor) => <article key={doctor.id} className={`crm-doctor-card ${doctor.active ? "" : "is-inactive"}`}>
        <header><div className="crm-doctor-card-avatar">{doctor.photoUrl ? <img src={doctor.photoUrl} alt=""/> : initials(doctor.nameEn)}</div><div className="min-w-0"><h3>{doctor.nameEn}</h3><p>{doctor.titleEn}</p><span>{doctor.specialtyName}</span></div></header>
        <div className="crm-doctor-statuses"><StatusPill tone={doctor.active ? "green" : "gray"}>{doctor.active ? "Active" : "Inactive"}</StatusPill><StatusPill tone={doctor.showOnBookingWebsite ? "blue" : "gray"}>{doctor.showOnBookingWebsite ? "Shown on booking" : "Hidden from booking"}</StatusPill></div>
        <dl><div><dt>Branches</dt><dd>{doctor.branchIds.map((id) => branchById.get(id)?.nameEn).filter(Boolean).join(", ") || "No branch assigned"}</dd></div><div><dt>Fee</dt><dd>{doctor.consultationFee === null ? "Hidden" : `EGP ${doctor.consultationFee}`}</dd></div></dl>
        <footer><button type="button" onClick={() => setEditing(doctor)}>Edit</button><DeleteDoctor doctor={doctor}/></footer>
      </article>)}
    </div>
    {doctors.length === 0 && <EmptyState title="No doctors match this view" hint="Clear the search or choose another status filter."/>}
    {editing && (
      <DoctorEditor key={editing === "new" ? "new" : editing.id} snapshot={snapshot} doctor={editing === "new" ? undefined : editing} onClose={() => setEditing(null)}/>
    )}
  </div>;
}
