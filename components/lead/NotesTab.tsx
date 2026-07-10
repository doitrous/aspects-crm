"use client";

import { useState, useTransition } from "react";
import type { LeadNote } from "@/lib/types";
import { saveLeadNoteAction } from "@/app/(crm)/leads/actions";

interface Section {
  key: keyof Omit<LeadNote, "updatedAt">;
  title: string;
  accent: string; // header text color
  bg: string; // card soft background
}

const SECTIONS: Section[] = [
  { key: "clientNotes", title: "Client Notes", accent: "#175cd3", bg: "#eff4ff" },
  { key: "medicalHistory", title: "Medical History", accent: "#c11574", bg: "#fdf2fa" },
  { key: "generalNotes", title: "Notes", accent: "#b54708", bg: "#fffaeb" },
];

export function NotesTab({ leadId, note }: { leadId: string; note: LeadNote }) {
  const [values, setValues] = useState({
    clientNotes: note.clientNotes,
    medicalHistory: note.medicalHistory,
    generalNotes: note.generalNotes,
  });
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function save(key: Section["key"]) {
    startTransition(async () => {
      setPendingKey(key);
      setSaved(null);
      setError(null);
      try {
        const result = await saveLeadNoteAction(leadId, key, values[key]);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaved(key);
        setTimeout(() => setSaved((s) => (s === key ? null : s)), 1600);
      } finally {
        setPendingKey(null);
      }
    });
  }

  return (
    <div className="grid gap-4 p-4 md:grid-cols-3">
      {SECTIONS.map((s) => (
        <div
          key={s.key}
          className="flex flex-col rounded-card border border-line p-3"
          style={{ background: s.bg }}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3
              className="font-display text-[14px] font-semibold"
              style={{ color: s.accent }}
            >
              {s.title}
            </h3>
            <button
              onClick={() => save(s.key)}
              disabled={pendingKey !== null}
              className="rounded-control bg-panel px-2.5 py-1 text-[11px] font-semibold text-ink-600 shadow-sm hover:text-primary disabled:opacity-60"
            >
              {pendingKey === s.key ? "Saving..." : saved === s.key ? "Saved" : "Save"}
            </button>
          </div>
          <textarea
            value={values[s.key]}
            onChange={(e) => setValues((v) => ({ ...v, [s.key]: e.target.value }))}
            placeholder={`Add ${s.title.toLowerCase()}…`}
            className="min-h-[150px] w-full resize-y rounded-lg border border-line bg-panel p-2.5 text-[12.5px] text-ink-800 placeholder:text-ink-400"
          />
        </div>
      ))}
      {error && (
        <div className="md:col-span-3 rounded-control bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger">
          {error}
        </div>
      )}
    </div>
  );
}
