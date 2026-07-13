"use client";

import { useMemo, useRef, useState, useTransition, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { parseSpreadsheetFile, type ParsedWorkbook } from "@/lib/import/spreadsheetFile";
import { autoMapLeadHeaders, LEAD_IMPORT_FIELDS, mapLeadImportRow, type LeadImportField } from "@/lib/import/leadImportMapping";
import { importLeadRows, type LeadImportResult, type LeadImportRowInput } from "@/app/(crm)/bulk-import/actions";
import { phoneDuplicateKey } from "@/lib/phoneMatching";

const inputClass = "h-9 rounded-control border border-line bg-white px-2.5 text-[12px] text-ink-800 outline-none focus:border-primary";
const REQUIRED_FIELDS: LeadImportField[] = ["mrn", "name", "phone", "nationality"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_ROWS = 5_000;
const IMPORT_BATCH_SIZE = 40;

function emptyImportResult(): LeadImportResult {
  return { ok: true, imported: 0, merged: 0, existing: 0, skipped: 0, failed: 0, rows: [] };
}

function combineImportResults(current: LeadImportResult, next: LeadImportResult): LeadImportResult {
  return {
    ok: current.ok && next.ok,
    error: next.error,
    imported: current.imported + next.imported,
    merged: current.merged + next.merged,
    existing: current.existing + next.existing,
    skipped: current.skipped + next.skipped,
    failed: current.failed + next.failed,
    // Successful rows are represented by the counters and never rendered.
    // Retain only rows that may need review so large imports do not leave
    // thousands of redundant result objects in browser memory.
    rows: [...current.rows, ...next.rows.filter((row) => row.status !== "imported")],
  };
}

function StepLabel({ step, children }: { step: number; children: React.ReactNode }) {
  return <div className="text-[10px] font-black uppercase tracking-[.16em] text-primary">Step {step} of 6 · {children}</div>;
}

export function PatientBulkImport() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mappingRef = useRef<HTMLDivElement>(null);
  const importIdRef = useRef<string | null>(null);
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [mapping, setMapping] = useState<Record<string, LeadImportField | "">>({});
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [showErrorColumnsOnly, setShowErrorColumnsOnly] = useState(false);
  const [importInvalid, setImportInvalid] = useState(false);
  const [mergeSameMrn, setMergeSameMrn] = useState(false);
  const [mergeSamePhone, setMergeSamePhone] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const [resumeOffset, setResumeOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number; batch: number; batches: number } | null>(null);
  const [pending, startTransition] = useTransition();
  const sheet = workbook?.sheets[sheetIndex] ?? null;

  function resetImportRun() {
    importIdRef.current = null;
    setResumeOffset(0);
    setPaused(false);
    setProgress(null);
    setResult(null);
  }

  async function loadFile(file: File) {
    setParsing(true);
    setParseError("");
    resetImportRun();
    setConfirmed(false);
    try {
      if (file.size > MAX_FILE_BYTES) {
        throw new Error("This workbook is larger than 20 MB. Split it into smaller files before importing.");
      }
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.sheets.some((item) => item.rows.length > MAX_IMPORT_ROWS)) {
        throw new Error("A worksheet may contain at most 5,000 patient rows. Split larger sheets before importing.");
      }
      setWorkbook(parsed);
      setSheetIndex(0);
      setMapping(autoMapLeadHeaders(parsed.sheets[0].headers));
      setFileName(file.name);
      setTimeout(() => mappingRef.current?.scrollIntoView({ behavior: "auto", block: "start" }), 0);
    } catch (error) {
      setWorkbook(null);
      setMapping({});
      setFileName(file.name);
      setParseError((error as Error).message);
    } finally {
      // Parsing is entirely browser-side. Clear the native input as soon as
      // its bytes have been consumed so the browser can release the File.
      if (fileInputRef.current) fileInputRef.current.value = "";
      setParsing(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function chooseSheet(index: number) {
    const next = workbook?.sheets[index];
    if (!next) return;
    setSheetIndex(index);
    setMapping(autoMapLeadHeaders(next.headers));
    setConfirmed(false);
    resetImportRun();
  }

  function mapColumn(header: string, field: LeadImportField | "") {
    setMapping((current) => {
      const next = { ...current };
      if (field) for (const source of Object.keys(next)) if (next[source] === field) next[source] = "";
      next[header] = field;
      return next;
    });
    setConfirmed(false);
    resetImportRun();
  }

  const mappedRows = useMemo(() => {
    if (!sheet) return [];
    const rows = sheet.rows.map((row, index) => mapLeadImportRow(row, sheet.headers, mapping, index));
    const seen = new Map<string, number>();
    for (const row of rows) {
      const phoneKey = phoneDuplicateKey(row.phone);
      const identities = [row.mrn && /^\d{1,9}$/.test(row.mrn) ? `MRN:${row.mrn}` : "", phoneKey ? `Phone:${phoneKey}` : ""].filter(Boolean);
      for (const identity of identities) {
        const earlier = seen.get(identity);
        if (earlier !== undefined) row.warnings.push(`${identity.split(":")[0]} duplicates import row ${earlier + 1}`);
        else seen.set(identity, row.rowIndex);
      }
    }
    return rows;
  }, [sheet, mapping]);

  const validRows = mappedRows.filter((row) => row.errors.length === 0);
  const invalidRows = mappedRows.filter((row) => row.errors.length > 0);
  const warningRows = mappedRows.filter((row) => row.warnings.length > 0);
  const missingMappings = REQUIRED_FIELDS.filter((field) => !Object.values(mapping).includes(field));
  const errorCounts = useMemo(() => {
    const counts = new Map<LeadImportField, number>();
    for (const row of mappedRows) for (const field of new Set(row.errorFields)) counts.set(field, (counts.get(field) ?? 0) + 1);
    return counts;
  }, [mappedRows]);
  const visibleHeaders = sheet?.headers.filter((header) => !showErrorColumnsOnly || (mapping[header] && errorCounts.has(mapping[header] as LeadImportField))) ?? [];
  const rowsToImport = importInvalid ? mappedRows.length : validRows.length;
  const rowsToSkip = importInvalid ? [] : invalidRows;

  function submitImport() {
    const payload: LeadImportRowInput[] = mappedRows.map((row) => ({
      rowIndex: row.rowIndex,
      name: row.name,
      phone: row.phone,
      mrn: row.mrn,
      nationality: row.nationality,
      gender: row.gender,
      source: row.source,
      serviceName: row.serviceName,
      doctorName: row.doctorName,
      specialtyName: row.specialtyName,
      age: Number.isFinite(row.age) ? row.age : undefined,
      patientType: row.patientType,
      notes: row.notes,
    }));
    startTransition(async () => {
      const totalBatches = Math.ceil(payload.length / IMPORT_BATCH_SIZE);
      const startingOffset = paused ? Math.min(resumeOffset, payload.length) : 0;
      setPaused(false);
      if (!importIdRef.current || startingOffset === 0) {
        importIdRef.current = crypto.randomUUID();
      }
      let aggregate = startingOffset > 0 && result
        ? { ...result, ok: true, error: undefined }
        : emptyImportResult();

      for (let offset = startingOffset; offset < payload.length; offset += IMPORT_BATCH_SIZE) {
        const batch = payload.slice(offset, offset + IMPORT_BATCH_SIZE);
        const batchIndex = Math.floor(offset / IMPORT_BATCH_SIZE) + 1;
        setProgress({ processed: offset, total: payload.length, batch: batchIndex, batches: totalBatches });
        try {
          const response = await importLeadRows(batch, {
            importInvalid,
            mergeSameMrn,
            mergeSamePhone,
            batch: {
              importId: importIdRef.current,
              index: batchIndex,
              total: totalBatches,
              isFinal: offset + batch.length >= payload.length,
            },
          });
          if (!response.ok) {
            setResumeOffset(offset);
            setPaused(true);
            setProgress({ processed: offset, total: payload.length, batch: batchIndex, batches: totalBatches });
            setResult({ ...aggregate, ok: false, error: response.error ?? "This batch could not be imported. Press Resume import to retry it." });
            return;
          }
          aggregate = combineImportResults(aggregate, response);
          const processed = offset + batch.length;
          setResumeOffset(processed);
          setProgress({ processed, total: payload.length, batch: batchIndex, batches: totalBatches });
        } catch {
          setResumeOffset(offset);
          setPaused(true);
          setProgress({ processed: offset, total: payload.length, batch: batchIndex, batches: totalBatches });
          setResult({
            ...aggregate,
            ok: false,
            error: `Import paused after ${offset.toLocaleString()} of ${payload.length.toLocaleString()} rows. Press Resume import to continue safely from this batch.`,
          });
          return;
        }
      }

      setResult({ ...aggregate, ok: true, error: undefined });
      setResumeOffset(0);
      setPaused(false);
      setConfirmed(false);
      importIdRef.current = null;
      // The result counters and exceptional rows are sufficient after a
      // completed import. Release the parsed workbook and mapping arrays.
      setWorkbook(null);
      setMapping({});
      setFileName("");
      setProgress(null);
      setShowErrorColumnsOnly(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  return <div className="space-y-4">
    <Card className="overflow-hidden border-primary/20">
      <div className="border-b border-line-soft bg-primary-soft/40 px-5 py-4"><StepLabel step={1}>Choose file</StepLabel><h2 className="mt-1 text-lg font-black text-ink-900">Choose a patient spreadsheet</h2><p className="mt-1 text-[12px] text-ink-500">Excel files open directly. No copy/paste is required.</p></div>
      <div onDragOver={(event) => event.preventDefault()} onDrop={onDrop} className="m-5 flex min-h-[190px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/35 bg-white px-5 text-center hover:bg-primary-soft/20">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-2xl">⇧</div><div className="text-[14px] font-black text-ink-900">Drop an Excel file here</div><div className="mt-1 text-[11.5px] text-ink-500">.xlsx, .csv, .tsv, or .txt</div>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={parsing} className="mt-4 min-h-10 rounded-xl bg-primary px-5 text-[12.5px] font-black text-white disabled:opacity-50">{parsing ? "Reading workbook…" : workbook ? "Choose another file" : "Choose file"}</button>
        <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} className="sr-only" />
        {fileName && !parseError && <div className="mt-3 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700">✓ {fileName} loaded</div>}{parseError && <div className="mt-3 max-w-xl rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] font-bold text-red-700">{parseError}</div>}
      </div>
    </Card>

    {sheet && <>
      <Card className="p-5">
        <StepLabel step={2}>Worksheet</StepLabel><div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-black text-ink-900">Confirm the worksheet</h2><p className="text-[12px] text-ink-500">{sheet.rows.length} patient rows and {sheet.headers.length} uploaded columns detected.</p></div>{workbook!.sheets.length > 1 && <select value={sheetIndex} onChange={(event) => chooseSheet(Number(event.target.value))} className={inputClass}>{workbook!.sheets.map((item, index) => <option key={`${item.name}-${index}`} value={index}>{item.name} ({item.rows.length} rows)</option>)}</select>}</div>
      </Card>

      <div ref={mappingRef}><Card className="p-5">
        <StepLabel step={3}>Column mapping</StepLabel><h2 className="mt-1 text-lg font-black text-ink-900">Map and inspect every uploaded column</h2><p className="mt-1 text-[12px] text-ink-500">Only MRN, patient name, phone number, and nationality can create blocking errors. Every other field is optional.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => setShowErrorColumnsOnly(false)} className={`rounded-lg px-3 py-2 text-[11px] font-bold ${!showErrorColumnsOnly ? "bg-primary text-white" : "border border-line text-ink-600"}`}>View all columns ({sheet.headers.length})</button><button type="button" onClick={() => setShowErrorColumnsOnly(true)} className={`rounded-lg px-3 py-2 text-[11px] font-bold ${showErrorColumnsOnly ? "bg-red-600 text-white" : "border border-red-200 bg-red-50 text-red-700"}`}>View columns with errors ({errorCounts.size})</button></div>
        {missingMappings.length > 0 && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[11.5px] font-bold text-red-700">Missing required mappings: {missingMappings.map((field) => LEAD_IMPORT_FIELDS.find((item) => item.key === field)?.label).join(", ")}. Every row will show an error until these are mapped.</div>}
        <div className="mt-3 overflow-x-auto rounded-xl border border-line-soft"><table className="w-full min-w-[760px] text-[12px]"><thead className="bg-line-faint/80 text-left text-[10px] font-black uppercase tracking-wide text-ink-500"><tr><th className="px-3 py-2.5">Uploaded column</th><th className="px-3 py-2.5">CRM field</th><th className="px-3 py-2.5">Example</th><th className="px-3 py-2.5">Errors</th></tr></thead><tbody>{visibleHeaders.map((header) => { const index = sheet.headers.indexOf(header); const field = mapping[header]; const errorCount = field ? errorCounts.get(field as LeadImportField) ?? 0 : 0; return <tr key={header} className={`border-t border-line-faint ${errorCount ? "bg-red-50/50" : ""}`}><td className="px-3 py-2.5 font-bold text-ink-800">{header}</td><td className="px-3 py-2"><select value={field ?? ""} onChange={(event) => mapColumn(header, event.target.value as LeadImportField | "")} className={`${inputClass} w-full`}><option value="">Do not import this column</option>{LEAD_IMPORT_FIELDS.map((item) => <option key={item.key} value={item.key}>{item.label}{item.required ? " *" : ""}</option>)}</select></td><td className="max-w-[260px] truncate px-3 py-2.5 text-ink-500">{sheet.rows[0]?.[index] || "—"}</td><td className="px-3 py-2.5">{errorCount ? <span className="rounded-full bg-red-100 px-2 py-1 font-bold text-red-700">{errorCount}</span> : <span className="text-ink-300">—</span>}</td></tr>; })}</tbody></table>{visibleHeaders.length === 0 && <div className="p-5 text-center text-[12px] font-semibold text-ink-400">No mapped source columns currently contain validation errors. Check the missing mappings above, or view all columns.</div>}</div>
      </Card></div>

      <Card className="p-5">
        <StepLabel step={4}>Full import preview</StepLabel><h2 className="mt-1 text-lg font-black text-ink-900">Preview all {mappedRows.length} imports</h2><div className="mt-2 flex flex-wrap gap-2 text-[11.5px]"><span className="rounded-full bg-emerald-50 px-3 py-1 font-bold text-emerald-700">{validRows.length} valid</span><span className="rounded-full bg-amber-50 px-3 py-1 font-bold text-amber-700">{warningRows.length} warnings</span><span className="rounded-full bg-red-50 px-3 py-1 font-bold text-red-700">{invalidRows.length} invalid</span></div>
        <div className="mt-3 max-h-[620px] overflow-auto rounded-xl border border-line-soft"><table className="w-full min-w-[1050px] text-[11.5px]"><thead className="sticky top-0 bg-line-faint text-left text-[10px] font-black uppercase tracking-wide text-ink-500"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">MRN</th><th className="px-3 py-2">Patient</th><th className="px-3 py-2">Phone</th><th className="px-3 py-2">Nationality</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Service</th><th className="px-3 py-2">Doctor / Specialty</th><th className="px-3 py-2">All errors and warnings</th></tr></thead><tbody>{mappedRows.map((row) => <tr key={row.rowIndex} className={`border-t border-line-faint ${row.errors.length ? "bg-red-50/60" : ""}`}><td className="px-3 py-2 font-mono text-ink-400">{row.rowIndex + 1}</td><td className="px-3 py-2 font-mono">{row.mrn || "—"}</td><td className="px-3 py-2 font-bold text-ink-800">{row.name || "—"}</td><td className="px-3 py-2">{row.phone || "—"}</td><td className="px-3 py-2">{row.nationality || "—"}</td><td className="px-3 py-2">{row.source || "—"}</td><td className="px-3 py-2">{row.serviceName || "—"}</td><td className="px-3 py-2">{[row.doctorName, row.specialtyName].filter(Boolean).join(" · ") || "—"}</td><td className="px-3 py-2">{row.errors.map((error) => <div key={error} className="font-bold text-red-700">• {error}</div>)}{row.warnings.map((warning) => <div key={warning} className="font-bold text-amber-700">• {warning}</div>)}{!row.errors.length && !row.warnings.length && <span className="font-bold text-emerald-700">Ready</span>}</td></tr>)}</tbody></table></div>
      </Card>

      <Card className="p-5">
        <StepLabel step={5}>Rows that will be skipped</StepLabel><h2 className="mt-1 text-lg font-black text-ink-900">{rowsToSkip.length ? `${rowsToSkip.length} rows will be skipped` : "No rows will be skipped for validation"}</h2><p className="mt-1 text-[12px] text-ink-500">Turn on “Import invalid rows too” in Step 6 to include rows listed here. Invalid values are preserved as import metadata when they cannot be placed in a validated CRM field.</p>
        {rowsToSkip.length > 0 && <div className="mt-3 max-h-64 overflow-auto rounded-xl border border-red-200 bg-red-50/40">{rowsToSkip.map((row) => <div key={row.rowIndex} className="border-b border-red-100 px-3 py-2 text-[11.5px]"><span className="font-mono font-bold text-red-700">Row {row.rowIndex + 1}</span><span className="ms-2 text-red-700">{row.errors.join(" · ")}</span></div>)}</div>}
      </Card>

      <Card className="border-primary/20 p-5">
        <StepLabel step={6}>Import options and submit</StepLabel><h2 className="mt-1 text-lg font-black text-ink-900">Import {rowsToImport} rows as regular CRM leads</h2><p className="mt-1 text-[12px] text-ink-500">No service, doctor, price, payment, or financial field is required. CRM Lead IDs are generated normally.</p>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          <label className={`flex items-start gap-2 rounded-xl border p-3 text-[12px] ${importInvalid ? "border-red-300 bg-red-50" : "border-line-soft"}`}><input type="checkbox" checked={importInvalid} disabled={pending} onChange={(event) => { setImportInvalid(event.target.checked); setConfirmed(false); resetImportRun(); }} className="mt-0.5"/><span><strong className="block text-ink-900">Import invalid rows too</strong>Include all {invalidRows.length} invalid rows instead of skipping them.</span></label>
          <label className={`flex items-start gap-2 rounded-xl border p-3 text-[12px] ${mergeSameMrn ? "border-primary bg-primary-soft" : "border-line-soft"}`}><input type="checkbox" checked={mergeSameMrn} disabled={pending} onChange={(event) => { setMergeSameMrn(event.target.checked); setConfirmed(false); resetImportRun(); }} className="mt-0.5"/><span><strong className="block text-ink-900">Bulk merge same MRN</strong>Enrich an existing lead when the MRN matches exactly.</span></label>
          <label className={`flex items-start gap-2 rounded-xl border p-3 text-[12px] ${mergeSamePhone ? "border-primary bg-primary-soft" : "border-line-soft"}`}><input type="checkbox" checked={mergeSamePhone} disabled={pending} onChange={(event) => { setMergeSamePhone(event.target.checked); setConfirmed(false); resetImportRun(); }} className="mt-0.5"/><span><strong className="block text-ink-900">Bulk merge same phone</strong>Enrich an existing lead when normalized phone digits match.</span></label>
        </div>
        <label className="mt-4 flex items-start gap-2 rounded-xl border border-line-soft bg-line-faint/40 p-3 text-[12px] font-semibold text-ink-700"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5"/><span>I reviewed all mappings, all preview rows, all visible errors, the skipped-row list, and the selected merge/override options.</span></label>
        {progress && <div className="mt-4 rounded-xl border border-primary/20 bg-primary-soft/30 p-3" role="status" aria-live="polite"><div className="flex items-center justify-between gap-3 text-[11.5px] font-bold text-ink-700"><span>{pending ? `Importing batch ${progress.batch} of ${progress.batches}` : paused ? "Import paused — ready to resume" : "Import complete"}</span><span>{progress.processed.toLocaleString()} / {progress.total.toLocaleString()} rows</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.total ? Math.round((progress.processed / progress.total) * 100) : 0}%` }} /></div></div>}
        <button type="button" onClick={submitImport} disabled={!confirmed || rowsToImport === 0 || pending} className="mt-4 min-h-11 rounded-xl bg-primary px-6 text-[13px] font-black text-white disabled:opacity-40">{pending ? `Importing ${progress?.processed.toLocaleString() ?? 0} / ${mappedRows.length.toLocaleString()}…` : paused ? `Resume import from row ${resumeOffset + 1}` : `Import ${rowsToImport} rows`}</button>
      </Card>
    </>}

    {result && <Card className="p-5"><h2 className="text-base font-black text-ink-900">Import result</h2>{result.error && <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 font-bold text-amber-800">{result.error}</p>}<div className="mt-3 flex flex-wrap gap-2 text-[12px]"><span className="rounded-full bg-emerald-50 px-3 py-1 font-bold text-emerald-700">{result.imported} created</span><span className="rounded-full bg-primary-soft px-3 py-1 font-bold text-primary">{result.merged} merged</span><span className="rounded-full bg-blue-50 px-3 py-1 font-bold text-blue-700">{result.existing} existing</span><span className="rounded-full bg-amber-50 px-3 py-1 font-bold text-amber-700">{result.skipped} skipped</span><span className="rounded-full bg-red-50 px-3 py-1 font-bold text-red-700">{result.failed} failed</span></div><div className="mt-3 max-h-64 overflow-auto text-[11.5px]">{result.rows.filter((row) => row.status !== "imported").map((row) => <div key={row.rowIndex} className="border-t border-line-faint py-2"><span className="font-mono text-ink-400">Row {row.rowIndex + 1}</span> · <span className={row.status === "error" ? "font-bold text-red-700" : "font-bold text-ink-700"}>{row.message}</span></div>)}</div></Card>}
  </div>;
}
