"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parse(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date();
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthCells(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function DateField({ name, defaultValue, ariaLabel, className = "", onChange }: { name: string; defaultValue: string; ariaLabel: string; className?: string; onChange?: (value: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(() => parse(defaultValue));
  const root = useRef<HTMLDivElement>(null);
  const today = iso(new Date());

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const cells = monthCells(cursor);
  const choose = (next: string, nextCursor?: Date) => {
    setValue(next);
    if (nextCursor) setCursor(nextCursor);
    onChange?.(next);
    setOpen(false);
  };
  return <div ref={root} className={`relative ${className}`}>
    <input type="hidden" name={name} value={value} />
    <button type="button" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-9 min-w-[170px] items-center justify-between gap-3 rounded-lg border border-line bg-white px-3 text-left text-[12px] font-semibold text-ink-800 shadow-sm outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"><span>{value ? formatDate(value) : "Choose date"}</span><span aria-hidden className="text-[15px] text-primary">▦</span></button>
    {open && <div className="absolute start-0 z-[90] mt-2 w-[304px] rounded-2xl border border-line bg-white p-3 shadow-toast">
      <div className="flex items-center justify-between px-1"><button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink-600 hover:bg-slate-100">‹</button><div className="text-[14px] font-black text-ink-900">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</div><button type="button" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-ink-600 hover:bg-slate-100">›</button></div>
      <div className="mt-2 grid grid-cols-7 gap-1">{DAYS.map((day) => <div key={day} className="py-1 text-center text-[10px] font-black uppercase text-ink-400">{day}</div>)}{cells.map((date) => { const key = iso(date); const selected = key === value; const currentMonth = date.getMonth() === cursor.getMonth(); const isToday = key === today; return <button key={key} type="button" onClick={() => choose(key, date)} className={`flex h-9 items-center justify-center rounded-lg text-[12px] font-bold transition ${selected ? "bg-primary text-white shadow-sm" : isToday ? "bg-primary-soft text-primary" : currentMonth ? "text-ink-700 hover:bg-slate-100" : "text-ink-300 hover:bg-slate-50"}`}>{date.getDate()}</button>; })}</div>
      <div className="mt-2 flex items-center justify-between border-t border-line-faint pt-2"><button type="button" onClick={() => choose("")} className="rounded-control px-2 py-1.5 text-[11px] font-bold text-ink-500 hover:bg-slate-100">Clear</button><button type="button" onClick={() => { const now = new Date(); choose(iso(now), now); }} className="rounded-control bg-primary-soft px-3 py-1.5 text-[11px] font-bold text-primary">Today</button></div>
    </div>}
  </div>;
}
