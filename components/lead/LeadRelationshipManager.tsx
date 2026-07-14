"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import type { Lead, LeadRelationship } from "@/lib/types";
import { linkLeadAction, unlinkLeadAction } from "@/app/(crm)/leads/actions";

type SearchLead = { id: string; mrn: string | null; name: string; phone: string };

const RELATIONSHIP_LABEL: Record<LeadRelationship, string> = {
  same_patient: "Same patient / same lead",
  relative: "Relative",
  distant_relative: "Distant relative",
  other: "Other",
};

export function LeadRelationshipManager({ leadId, relationships = [], onChanged }: { leadId: string; relationships?: Lead["linkedLeads"]; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchLead[]>([]);
  const [selected, setSelected] = useState<SearchLead | null>(null);
  const [relationship, setRelationship] = useState<LeadRelationship>("same_patient");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || selected?.id === term) { setResults([]); return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/leads/search?q=${encodeURIComponent(term)}&exclude=${encodeURIComponent(leadId)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("Search failed")))
        .then((payload: { leads?: SearchLead[] }) => setResults(payload.leads ?? []))
        .catch((error) => { if (error.name !== "AbortError") setResults([]); });
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [leadId, query, selected?.id]);

  function save() {
    if (!selected) { setMessage("Choose a lead first."); return; }
    startTransition(async () => {
      const formData = new FormData();
      formData.set("targetLeadId", selected.id);
      formData.set("relationship", relationship);
      formData.set("notes", notes);
      const result = await linkLeadAction(leadId, formData);
      setMessage(result.error ?? result.ok ?? "");
      if (!result.error) {
        setQuery(""); setSelected(null); setNotes(""); setResults([]); onChanged();
      }
    });
  }

  function unlink(linkId: string) {
    if (!window.confirm("Unlink these leads? Both patient records and all history will be retained.")) return;
    startTransition(async () => {
      const result = await unlinkLeadAction(leadId, linkId);
      setMessage(result.error ?? result.ok ?? "");
      if (!result.error) onChanged();
    });
  }

  return (
    <section className="rounded-xl border border-line bg-panel p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="text-[14px] font-black text-ink-900">Linked patients &amp; family</h3><p className="mt-0.5 text-[11px] text-ink-500">Links connect records without merging or deleting either patient.</p></div>
        <span className="rounded-pill bg-primary-soft px-2 py-1 text-[10px] font-bold text-primary">{relationships?.length ?? 0} linked</span>
      </div>

      {!!relationships?.length && <div className="mt-3 grid gap-2 md:grid-cols-2">
        {relationships.map((item) => <div key={item.linkId} className="flex items-center gap-3 rounded-lg border border-line-soft bg-slate-50 p-3"><div className="min-w-0 flex-1"><Link href={`/leads/${item.id}`} className="font-mono text-[11px] font-black text-primary hover:underline">{item.id}</Link><div className="truncate text-[12px] font-bold text-ink-800">{item.name}</div><div className="text-[10.5px] text-ink-500">{RELATIONSHIP_LABEL[item.relationship]} · {item.phone || "No phone"}</div></div><button type="button" disabled={pending} onClick={() => unlink(item.linkId)} className="rounded-control border border-rose-200 px-2.5 py-1.5 text-[10.5px] font-bold text-danger hover:bg-rose-50 disabled:opacity-50">Unlink</button></div>)}
      </div>}

      <div className="mt-4 border-t border-line-soft pt-3">
        <div className="grid gap-2 md:grid-cols-[1.4fr_.8fr]">
          <label className="relative text-[11px] font-bold text-ink-500">Find Lead ID, MRN, name, or phone
            <input value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Start typing to search all Database patients…" className="calm-field mt-1 h-9 w-full px-3 text-[12px]" />
            {results.length > 0 && <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-line bg-white p-1 shadow-toast">{results.map((lead) => <button key={lead.id} type="button" onClick={() => { setSelected(lead); setQuery(lead.id); setResults([]); }} className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left hover:bg-primary-soft"><span><b className="block text-[12px] text-ink-900">{lead.name}</b><span className="text-[10.5px] text-ink-500">MRN {lead.mrn || "missing"} · {lead.phone || "No phone"}</span></span><span className="font-mono text-[10.5px] font-bold text-primary">{lead.id}</span></button>)}</div>}
          </label>
          <label className="text-[11px] font-bold text-ink-500">Relationship
            <select value={relationship} onChange={(event) => setRelationship(event.target.value as LeadRelationship)} className="mt-1 h-9 w-full rounded-control border border-line bg-panel px-2.5 text-[12px]">{Object.entries(RELATIONSHIP_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2"><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional relationship note" className="calm-field h-9 min-w-[220px] flex-1 px-3 text-[12px]" /><button type="button" onClick={save} disabled={pending || !selected} className="h-9 rounded-control bg-primary px-4 text-[11.5px] font-bold text-white disabled:opacity-50">{pending ? "Saving…" : "Link patient"}</button></div>
        {message && <p className="mt-2 text-[10.5px] font-semibold text-ink-600">{message}</p>}
      </div>
    </section>
  );
}
