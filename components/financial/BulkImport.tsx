"use client";

import { useMemo, useState, useTransition, type ChangeEvent } from "react";
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

const field = "rounded-control border border-line-soft bg-panel px-2 py-1.5 text-[12px] text-ink-800 outline-none focus:border-primary";

export function BulkImport() {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, CanonicalField | "">>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  function doParse(raw: string) {
    const p = parseDelimited(raw);
    setParsed(p.headers.length ? p : null);
    setMapping(p.headers.length ? autoMap(p.headers) : {});
    setResult(null);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      setText(raw);
      doParse(raw);
    };
    reader.readAsText(file);
  }

  const mappedRows = useMemo(() => {
    if (!parsed) return [];
    return parsed.rows.map((r, i) => mapRow(r, parsed.headers, mapping, i));
  }, [parsed, mapping]);

  const validRows = mappedRows.filter((r) => r.errors.length === 0);
  const errorRows = mappedRows.filter((r) => r.errors.length > 0);

  function runImport() {
    const payload: ImportRowInput[] = validRows.map((r) => ({
      rowIndex: r.rowIndex,
      leadId: r.leadId,
      mrn: r.mrn,
      phone: r.phone,
      serviceName: r.serviceName,
      serviceDate: r.serviceDate,
      basePrice: r.basePrice,
      quotedPrice: r.quotedPrice,
      amountPaid: r.amountPaid,
      method: r.method,
    }));
    startTransition(async () => {
      const res = await importFinancialRows(payload);
      setResult(res);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="mb-1 text-[13px] font-bold text-ink-900">1 · Load a CSV/TSV file</h3>
        <p className="mb-2 text-[11.5px] text-ink-500">
          Upload a <code className="rounded bg-line-faint px-1">.csv</code>/<code className="rounded bg-line-faint px-1">.tsv</code> file
          or paste rows below. Export Excel sheets as CSV first. Columns can be in any order (EN/AR headers auto-detected). Values import
          into the same canonical financial tables the lead Payments tab uses.
        </p>
        <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={onFile} className="mb-2 block text-[12px]" />
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
          <h3 className="mb-2 text-[13px] font-bold text-ink-900">2 · Map columns</h3>
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
        </Card>
      )}

      {parsed && (
        <Card className="p-4">
          <h3 className="mb-2 text-[13px] font-bold text-ink-900">3 · Preview & validate</h3>
          <div className="mb-2 flex flex-wrap gap-2 text-[12px]">
            <span className="rounded-pill bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700">{validRows.length} ready</span>
            <span className="rounded-pill bg-red-100 px-2.5 py-1 font-semibold text-red-700">{errorRows.length} with errors (skipped)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[11.5px]">
              <thead>
                <tr className="border-b border-line-soft text-left text-[10.5px] font-semibold uppercase tracking-wide text-ink-400">
                  <th className="px-2 py-1.5">Row</th>
                  <th className="px-2 py-1.5">Match key</th>
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
                    <td className="px-2 py-1.5 font-mono text-ink-700">{r.leadId || r.mrn || r.phone || "—"}</td>
                    <td className="px-2 py-1.5 text-ink-700">{r.serviceName ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.basePrice ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.quotedPrice ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.amountPaid ?? "—"}</td>
                    <td className="px-2 py-1.5">{r.method ?? "—"}</td>
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
          <button
            onClick={runImport}
            disabled={pending || validRows.length === 0}
            className="mt-3 h-9 rounded-control bg-primary px-4 text-[12.5px] font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
          >
            {pending ? "Importing…" : `Import ${validRows.length} rows`}
          </button>
        </Card>
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
