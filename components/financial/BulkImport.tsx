"use client";

import { useMemo, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import {
  parseDelimited,
  autoMap,
  mapRow,
  CANONICAL_FIELDS,
  type CanonicalField,
} from "@/lib/financial/importMapping";
import {
  importFinancialRows,
  type ImportResult,
  type ImportRowInput,
} from "@/app/(crm)/financial/import/actions";
import { Card } from "@/components/ui/Card";
import { parseSpreadsheetFile, type ParsedSheet } from "@/lib/import/spreadsheetFile";

const field = "rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary";
const stepTitle = "text-[13px] font-bold text-ink-900";

export function BulkImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<Record<string, CanonicalField | "">>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const previewRef = useRef<HTMLDivElement>(null);

  function openPreview() {
    setPreviewOpen(true);
    setConfirmed(false);
    setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function setParsedSheet(sheet: ParsedSheet, openPreviewAfterParse = false) {
    setParsed(sheet.headers.length ? sheet : null);
    setMapping(sheet.headers.length ? autoMap(sheet.headers) : {});
    setResult(null);
    setConfirmed(false);
    setPreviewOpen(openPreviewAfterParse);
    setParseError("");
    if (openPreviewAfterParse) setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function doParse(raw: string) {
    const p = parseDelimited(raw);
    setParsedSheet({ name: "Pasted data", ...p });
  }

  async function parseFile(file: File) {
    if (!file) return;
    setFileName(file.name);
    setParseError("");
    try {
      const parsedWorkbook = await parseSpreadsheetFile(file);
      setText("");
      setParsedSheet(parsedWorkbook.sheets[0], true);
    } catch (err) {
      setParsed(null);
      setMapping({});
      setParseError((err as Error).message);
    } finally {
      // The workbook is parsed locally and never uploaded as a temporary
      // server file. Drop the native File reference after reading its bytes.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void parseFile(file);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) void parseFile(file);
  }

  const mappedRows = useMemo(() => {
    if (!parsed) return [];
    const rows = parsed.rows.map((r, i) => mapRow(r, parsed.headers, mapping, i));
    const seen = new Map<string, number>();
    for (const r of rows) {
      const key = (r.leadId && `lead:${r.leadId}`) || (r.mrn && `mrn:${r.mrn}`) || (r.phone && `phone:${r.phone.replace(/\D/g, "").slice(-9)}`) || "";
      if (!key) continue;
      const prior = seen.get(key);
      if (prior !== undefined) {
        r.warnings.push(`Duplicate identity also appears on import row ${prior + 1}.`);
      } else {
        seen.set(key, r.rowIndex);
      }
    }
    return rows;
  }, [parsed, mapping]);

  const validRows = mappedRows.filter((r) => r.errors.length === 0);
  const errorRows = mappedRows.filter((r) => r.errors.length > 0);
  const warningRows = mappedRows.filter((r) => r.warnings.length > 0);

  function runImport() {
    const payload: ImportRowInput[] = validRows.map((r) => ({
      rowIndex: r.rowIndex,
      leadId: r.leadId,
      mrn: r.mrn,
      phone: r.phone,
      name: r.name,
      age: r.age,
      patientType: r.patientType,
      source: r.source,
      doctorCode: r.doctorCode,
      doctorName: r.doctorName,
      specialtyName: r.specialtyName,
      serviceCode: r.serviceCode,
      serviceName: r.serviceName,
      serviceDate: r.serviceDate,
      basePrice: r.basePrice,
      quotedPrice: r.quotedPrice,
      consumables: r.consumables,
      doctorPercent: r.doctorPercent,
      netAfterConsumablesDoctorPercent: r.netAfterConsumablesDoctorPercent,
      amountPaid: r.amountPaid,
      method: r.method,
      paymentByDoctor: r.paymentByDoctor,
      externalPayments: r.externalPayments,
    }));
    startTransition(async () => {
      const res = await importFinancialRows(payload);
      setResult({
        ...res,
        // Imported rows are fully represented by the summary count and are
        // not rendered in the result panel. Keep only reviewable outcomes.
        rows: res.rows.filter((row) => row.status !== "imported"),
      });
      setConfirmed(false);
      if (!res.error) {
        setParsed(null);
        setMapping({});
        setText("");
        setFileName("");
        setPreviewOpen(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className={`mb-1 ${stepTitle}`}>Step 1 - Upload file</h3>
        <p className="mb-2 text-[11.5px] text-ink-500">
          Upload Excel, CSV, or TSV files. RTL/LTR headers are detected where possible, and column order is never assumed.
        </p>
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          className="mb-2 flex cursor-pointer flex-col items-center justify-center rounded-control border border-dashed border-line-soft bg-line-faint/30 px-3 py-5 text-center text-[12px] text-ink-600 hover:border-primary"
        >
          <span className="font-semibold text-ink-800">Drop file here or choose a file</span>
          <span className="mt-1 text-[11px] text-ink-400">Supported: .xlsx, .csv, .tsv, .txt</span>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="sr-only" />
        </label>
        {fileName && <div className="mb-2 text-[11.5px] font-semibold text-ink-500">Loaded: {fileName}</div>}
        {parseError && <div className="mb-2 text-[12px] font-semibold text-red-600">{parseError}</div>}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => doParse(text)}
          rows={5}
          dir="auto"
          placeholder="Lead ID,Service,Service Price,Price After Discount,Amount Paid,Payment Method"
          className={`${field} w-full font-mono`}
        />
        <button
          onClick={() => doParse(text)}
          className="mt-2 h-8 rounded-control border border-line-soft px-3 text-[12px] font-semibold text-ink-700 hover:bg-line-faint/60"
        >
          Parse
        </button>
      </Card>

      {parsed && (
        <Card className="p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
            <div><div className="text-[12.5px] font-bold text-ink-900">Review the uploaded sheet before importing</div><div className="text-[11px] text-ink-500">See every uploaded column beside its mapped CRM data. Nothing is written until confirmation.</div></div>
            <button type="button" onClick={openPreview} className="h-9 rounded-control bg-primary px-4 text-[12.5px] font-bold text-white shadow-sm hover:bg-primary-hover">Preview mapping</button>
          </div>
          <h3 className={`mb-2 ${stepTitle}`}>Step 2 - Detected headers and sample rows</h3>
          <div className="mb-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[11.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                  {parsed.headers.map((h) => <th key={h} className="px-2 py-1.5">{h || "Blank"}</th>)}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 3).map((row, idx) => (
                  <tr key={idx} className="border-b border-line-faint">
                    {parsed.headers.map((h, col) => <td key={`${h}-${col}`} className="px-2 py-1.5 text-ink-600">{row[col] || "-"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3 className={`mb-2 ${stepTitle}`}>Step 3 - Column mapping</h3>
          <p className="mb-2 text-[11.5px] text-ink-500">Imported Column {"->"} CRM Field. Every mapping can be changed before preview/import.</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {CANONICAL_FIELDS.map((f) => {
              const current = Object.keys(mapping).find((h) => mapping[h] === f.key) ?? "";
              return (
                <label key={f.key} className="flex flex-col gap-1 text-[11px] font-semibold text-ink-500">
                  {f.label}
                  <select
                    value={current}
                    onChange={(e) => {
                      const header = e.target.value;
                      setMapping((prev) => {
                        const next = { ...prev };
                        for (const h of Object.keys(next)) if (next[h] === f.key) next[h] = "";
                        if (header) next[header] = f.key;
                        return next;
                      });
                    }}
                    className={field}
                  >
                    <option value="">— none —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-2"><button type="button" onClick={openPreview} className="h-9 rounded-control bg-primary px-4 text-[12.5px] font-bold text-white shadow-sm hover:bg-primary-hover">Preview mapping</button><span className="text-[11px] text-ink-400">Required before merge/import</span></div>
        </Card>
      )}

      {parsed && previewOpen && (
        <div ref={previewRef} className="scroll-mt-4">
        <Card className="p-4">
          <h3 className={`mb-2 ${stepTitle}`}>Step 4 - Preview</h3>
          <p className="mb-3 text-[11.5px] text-ink-500">Compare the original uploaded columns with the transformed CRM rows. Nothing has been written yet.</p>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">Uploaded file — original columns</h4>
          <div className="mb-4 max-h-[360px] overflow-auto rounded-control border border-line-soft">
            <table className="w-full min-w-max text-[11px]"><thead className="sticky top-0 bg-line-faint text-left font-bold text-ink-600"><tr><th className="px-2 py-2">Row</th>{parsed.headers.map((header,index)=><th key={`${header}-${index}`} className="whitespace-nowrap px-2 py-2">{header || `Column ${index+1}`}</th>)}</tr></thead><tbody>{parsed.rows.slice(0,25).map((row,rowIndex)=><tr key={rowIndex} className="border-t border-line-faint"><td className="px-2 py-1.5 font-mono text-ink-400">{rowIndex+1}</td>{parsed.headers.map((header,col)=><td key={`${header}-${col}`} className="max-w-[260px] whitespace-nowrap px-2 py-1.5 text-ink-700">{row[col] || "—"}</td>)}</tr>)}</tbody></table>
          </div>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">Mapped CRM preview</h4>
          <div className="mb-2 flex flex-wrap gap-2 text-[12px]">
            <span className="rounded-pill bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">{validRows.length} ready</span>
            <span className="rounded-pill bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">{warningRows.length} with warnings</span>
            <span className="rounded-pill bg-red-100 px-2.5 py-1 font-semibold text-red-700">{errorRows.length} with errors (skipped)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[11.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-2 py-1.5">Row</th>
                  <th className="px-2 py-1.5">Match key</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Doctor</th>
                  <th className="px-2 py-1.5">Service</th>
                  <th className="px-2 py-1.5">Base</th>
                  <th className="px-2 py-1.5">Quoted</th>
                  <th className="px-2 py-1.5">Paid</th>
                  <th className="px-2 py-1.5">Method</th>
                  <th className="px-2 py-1.5">Issues</th>
                </tr>
              </thead>
              <tbody>
                {mappedRows.slice(0, 25).map((r) => (
                  <tr key={r.rowIndex} className={"border-b border-line-faint " + (r.errors.length ? "bg-red-50" : "")}>
                    <td className="px-2 py-1.5 text-ink-500">{r.rowIndex + 1}</td>
                    <td className="px-2 py-1.5 font-mono text-ink-700">{r.leadId || r.mrn || r.phone || "-"}</td>
                    <td className="px-2 py-1.5 text-ink-700">{r.name ?? "-"}</td>
                    <td className="px-2 py-1.5 text-ink-700">{r.doctorName ?? r.doctorCode ?? "-"}</td>
                    <td className="px-2 py-1.5 text-ink-700">{r.serviceName ?? r.serviceCode ?? "-"}</td>
                    <td className="px-2 py-1.5">{r.basePrice ?? "-"}</td>
                    <td className="px-2 py-1.5">{r.quotedPrice ?? "-"}</td>
                    <td className="px-2 py-1.5">{r.amountPaid ?? "-"}</td>
                    <td className="px-2 py-1.5">{r.method ?? "-"}</td>
                    <td className="px-2 py-1.5">
                      {r.errors.map((e, i) => <div key={i} className="text-red-600">{e}</div>)}
                      {r.warnings.map((w, i) => <div key={i} className="text-amber-600">{w}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {mappedRows.length > 25 && <div className="mt-1 text-[11px] text-ink-400">…and {mappedRows.length - 25} more rows.</div>}
          </div>
          <div className="mt-4 rounded-control border border-line-soft bg-panel/70 p-3">
            <h3 className={`mb-2 ${stepTitle}`}>Step 5 - Validation</h3>
            <div className="grid gap-2 text-[12px] sm:grid-cols-4">
              <div><span className="font-bold text-emerald-700">{validRows.length}</span> valid rows</div>
              <div><span className="font-bold text-amber-700">{warningRows.length}</span> warning rows</div>
              <div><span className="font-bold text-red-700">{errorRows.length}</span> invalid rows</div>
              <div><span className="font-bold text-ink-700">{mappedRows.length}</span> total rows</div>
            </div>
            <p className="mt-2 text-[11.5px] text-ink-500">
              Invalid rows will not be imported. Warnings identify duplicates, unresolved complex finance columns, or data that requires review.
            </p>
          </div>
          <div className="mt-4 rounded-control border border-line-soft bg-white p-3">
            <h3 className={`mb-2 ${stepTitle}`}>Step 6 - Confirm import</h3>
            <label className="flex items-start gap-2 text-[12px] text-ink-700">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
              <span>I reviewed the preview and validation results. Import only the valid rows into the canonical CRM tables.</span>
            </label>
          </div>
          <button
            onClick={runImport}
            disabled={pending || validRows.length === 0 || !confirmed}
            className="mt-3 h-9 rounded-control bg-primary px-4 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? "Importing…" : `Import ${validRows.length} rows`}
          </button>
        </Card>
        </div>
      )}

      {result && (
        <Card className="p-4">
          <h3 className="mb-2 text-[13px] font-bold text-ink-900">Result</h3>
          {result.error ? (
            <div className="text-[12px] font-semibold text-red-600">{result.error}</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-2 text-[12px]">
                <span className="rounded-pill bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">{result.imported} imported</span>
                <span className="rounded-pill bg-amber-100 px-2.5 py-1 font-semibold text-amber-700">{result.needsApproval} need approval</span>
                <span className="rounded-pill bg-line-faint px-2.5 py-1 font-semibold text-ink-600">{result.unresolved} unresolved</span>
                <span className="rounded-pill bg-red-100 px-2.5 py-1 font-semibold text-red-700">{result.failed} failed</span>
              </div>
              <div className="max-h-[240px] overflow-auto text-[11.5px]">
                {result.rows.filter((r) => r.status !== "imported").map((r) => (
                  <div key={r.rowIndex} className="border-b border-line-faint py-1">
                    <span className="font-mono text-ink-500">Row {r.rowIndex + 1}</span>{" "}
                    <span className={r.status === "needs_approval" ? "text-amber-600" : r.status === "unresolved" ? "text-ink-500" : "text-red-600"}>
                      {r.status}
                    </span>{" "}
                    <span className="text-ink-600">— {r.message}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
