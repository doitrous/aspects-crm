import { strFromU8, unzipSync } from "fflate";
import { parseDelimited } from "@/lib/financial/importMapping";

const MAX_XLSX_EXPANDED_BYTES = 50 * 1024 * 1024;

function requiredXlsxEntry(path: string): boolean {
  return path === "xl/workbook.xml" ||
    path === "xl/_rels/workbook.xml.rels" ||
    path === "xl/sharedStrings.xml" ||
    /^xl\/worksheets\/[^/]+\.xml$/i.test(path);
}

export interface ParsedSheet {
  name: string;
  headers: string[];
  rows: string[][];
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, token: string) => {
    if (token.toLowerCase() === "amp") return "&";
    if (token.toLowerCase() === "lt") return "<";
    if (token.toLowerCase() === "gt") return ">";
    if (token.toLowerCase() === "quot") return '"';
    if (token.toLowerCase() === "apos") return "'";
    const numeric = token.toLowerCase().startsWith("#x") ? Number.parseInt(token.slice(2), 16) : Number.parseInt(token.slice(1), 10);
    return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
  });
}

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(":", "\\:");
  const match = tag.match(new RegExp(`(?:^|\\s)${escaped}=(?:"([^"]*)"|'([^']*)')`, "i"));
  return match ? decodeXml(match[1] ?? match[2] ?? "") : undefined;
}

function textRuns(xml: string): string {
  return Array.from(xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi), (match) => decodeXml(match[1])).join("");
}

function uniqueHeaders(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = value.trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

function cellIndex(reference: string | null): number {
  const letters = (reference ?? "").match(/[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

function resolveWorkbookTarget(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = ["xl", ...target.replace(/\\/g, "/").split("/")];
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") normalized.pop();
    else normalized.push(part);
  }
  return normalized.join("/");
}

function worksheetRows(xml: string, sharedStrings: string[]): string[][] {
  const output: string[][] = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<((?:\w+:)?c)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const cellTag = cellMatch[2];
      const cellXml = cellMatch[3];
      const index = cellIndex(attribute(cellTag, "r") ?? null);
      const type = attribute(cellTag, "t");
      const raw = decodeXml(cellXml.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1] ?? "");
      if (type === "s") values[index] = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") values[index] = textRuns(cellXml);
      else if (type === "b") values[index] = raw === "1" ? "TRUE" : "FALSE";
      else values[index] = raw || textRuns(cellXml);
    }
    if (values.some((value) => (value ?? "").trim() !== "")) output.push(values.map((value) => value ?? ""));
  }
  return output;
}

export function parseXlsxWorkbook(buffer: ArrayBuffer): ParsedWorkbook {
  let archive: Record<string, Uint8Array>;
  let expandedBytes = 0;
  let tooLarge = false;
  try {
    archive = unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        if (!requiredXlsxEntry(file.name)) return false;
        expandedBytes += file.originalSize;
        if (expandedBytes > MAX_XLSX_EXPANDED_BYTES) {
          tooLarge = true;
          throw new Error("expanded workbook too large");
        }
        return true;
      },
    });
  } catch {
    if (tooLarge) {
      throw new Error("This workbook expands beyond the 50 MB safety limit. Split it into smaller files before importing.");
    }
    throw new Error("This file could not be opened as an XLSX workbook. Check that it is a valid, non-password-protected Excel file.");
  }

  const xml = (path: string): string | undefined => archive[path] ? strFromU8(archive[path]) : undefined;
  const sharedStrings = Array.from((xml("xl/sharedStrings.xml") ?? "").matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi), (match) => textRuns(match[1]));
  const workbookXml = xml("xl/workbook.xml");
  const relationshipsXml = xml("xl/_rels/workbook.xml.rels");
  const sheetDefinitions: { name: string; path: string }[] = [];

  if (workbookXml && relationshipsXml) {
    const targets = new Map<string, string>();
    for (const relationship of relationshipsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?\s*>/gi)) {
      const id = attribute(relationship[1], "Id");
      const target = attribute(relationship[1], "Target");
      if (id && target) targets.set(id, target);
    }
    for (const [index, sheet] of Array.from(workbookXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?\s*>/gi)).entries()) {
      const relationshipId = attribute(sheet[1], "r:id") ?? "";
      const target = targets.get(relationshipId);
      if (target) sheetDefinitions.push({ name: attribute(sheet[1], "name") || `Sheet ${index + 1}`, path: resolveWorkbookTarget(target) });
    }
  }

  if (sheetDefinitions.length === 0) {
    Object.keys(archive)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort()
      .forEach((path, index) => sheetDefinitions.push({ name: `Sheet ${index + 1}`, path }));
  }

  const sheets = sheetDefinitions.flatMap(({ name, path }) => {
    const sheetXml = xml(path);
    if (!sheetXml) return [];
    const rows = worksheetRows(sheetXml, sharedStrings);
    if (rows.length === 0) return [];
    const headers = uniqueHeaders(rows.shift() ?? []);
    return headers.length ? [{ name, headers, rows }] : [];
  });

  if (sheets.length === 0) throw new Error("No readable worksheet with a header row was found in this XLSX file.");
  return { sheets };
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedWorkbook> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".xlsx")) return parseXlsxWorkbook(await file.arrayBuffer());
  if (!/\.(csv|tsv|txt)$/i.test(lower)) throw new Error("Choose an .xlsx, .csv, .tsv, or .txt file.");
  const parsed = parseDelimited(await file.text());
  if (!parsed.headers.length) throw new Error("No header row was found in this file.");
  return { sheets: [{ name: "Imported data", headers: uniqueHeaders(parsed.headers), rows: parsed.rows }] };
}
