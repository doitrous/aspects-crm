/**
 * Pure helpers for financial bulk import (§36): CSV/TSV parsing, header
 * auto-mapping (EN + AR aliases), row normalization and validation. No I/O, so
 * it is unit tested; the DB write happens in the import server action, which
 * reuses the canonical `saveQuote` / `addTransaction` path (one source of truth).
 */

export type CanonicalField =
  | "leadId"
  | "mrn"
  | "phone"
  | "name"
  | "age"
  | "patientType"
  | "source"
  | "doctorCode"
  | "doctorName"
  | "specialtyName"
  | "serviceCode"
  | "serviceName"
  | "serviceDate"
  | "basePrice"
  | "priceAfterDiscount"
  | "discount"
  | "consumables"
  | "doctorPercent"
  | "netAfterConsumablesDoctorPercent"
  | "amountPaid"
  | "paymentMethod"
  | "paymentByDoctor"
  | "externalPayments";

export const CANONICAL_FIELDS: { key: CanonicalField; label: string; required?: boolean }[] = [
  { key: "leadId", label: "Lead ID (match key)" },
  { key: "mrn", label: "MRN (match key)" },
  { key: "phone", label: "Phone (match key)" },
  { key: "name", label: "Name (reference only)" },
  { key: "age", label: "Age" },
  { key: "patientType", label: "Patient type" },
  { key: "source", label: "Source" },
  { key: "doctorCode", label: "Doctor code" },
  { key: "doctorName", label: "Doctor" },
  { key: "specialtyName", label: "Specialty" },
  { key: "serviceCode", label: "Service code" },
  { key: "serviceName", label: "Service" },
  { key: "serviceDate", label: "Service/procedure date" },
  { key: "basePrice", label: "Service price (base)" },
  { key: "priceAfterDiscount", label: "Price after discount (quoted)" },
  { key: "discount", label: "Discount amount" },
  { key: "consumables", label: "Consumables" },
  { key: "doctorPercent", label: "Doctor %" },
  { key: "netAfterConsumablesDoctorPercent", label: "Net after consumables + Doctor %" },
  { key: "amountPaid", label: "Amount paid" },
  { key: "paymentMethod", label: "Payment method" },
  { key: "paymentByDoctor", label: "Payment by doctor" },
  { key: "externalPayments", label: "External payments" },
];

/** Header text → canonical field. Lower-cased, punctuation-insensitive match. */
const ALIASES: Record<string, CanonicalField> = {
  "lead id": "leadId",
  "leadid": "leadId",
  "mrn": "mrn",
  "medical record": "mrn",
  "medical record number": "mrn",
  "patient mrn": "mrn",
  "clinic mrn": "mrn",
  "رقم الملف": "mrn",
  "رقم السجل الطبي": "mrn",
  "phone": "phone",
  "phone no": "phone",
  "phone number": "phone",
  "mobile": "phone",
  "رقم الهاتف": "phone",
  "name": "name",
  "patient name": "name",
  "الاسم": "name",
  "age": "age",
  "العمر": "age",
  "patient type": "patientType",
  "نوع المريض": "patientType",
  "source": "source",
  "lead source": "source",
  "المصدر": "source",
  "doctor code": "doctorCode",
  "كود الطبيب": "doctorCode",
  "doctor": "doctorName",
  "doctor name": "doctorName",
  "الطبيب": "doctorName",
  "specialty": "specialtyName",
  "التخصص": "specialtyName",
  "service code": "serviceCode",
  "كود الخدمة": "serviceCode",
  "service": "serviceName",
  "service name": "serviceName",
  "الخدمة": "serviceName",
  "date": "serviceDate",
  "service date": "serviceDate",
  "التاريخ": "serviceDate",
  "service price": "basePrice",
  "price": "basePrice",
  "base price": "basePrice",
  "سعر الخدمة": "basePrice",
  "price after discount": "priceAfterDiscount",
  "net price": "priceAfterDiscount",
  "quoted price": "priceAfterDiscount",
  "السعر بعد الخصم": "priceAfterDiscount",
  "discount": "discount",
  "الخصم": "discount",
  "consumables": "consumables",
  "المستهلكات": "consumables",
  "doctor %": "doctorPercent",
  "doctor percent": "doctorPercent",
  "نسبة الطبيب": "doctorPercent",
  "net after consumables + doctor %": "netAfterConsumablesDoctorPercent",
  "net after consumables doctor": "netAfterConsumablesDoctorPercent",
  "amount paid": "amountPaid",
  "paid": "amountPaid",
  "payment": "amountPaid",
  "المبلغ المدفوع": "amountPaid",
  "payment method": "paymentMethod",
  "method": "paymentMethod",
  "طريقة الدفع": "paymentMethod",
  "payment by doctor": "paymentByDoctor",
  "paid by doctor": "paymentByDoctor",
  "external payments": "externalPayments",
  "external payment": "externalPayments",
};

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

/** Best-effort automatic mapping of source headers → canonical fields. */
export function autoMap(headers: string[]): Record<string, CanonicalField | ""> {
  const map: Record<string, CanonicalField | ""> = {};
  for (const h of headers) map[h] = ALIASES[norm(h)] ?? "";
  return map;
}

/** RFC4180-ish parser; auto-detects comma vs tab. Returns headers + string rows. */
export function parseDelimited(text: string): { headers: string[]; rows: string[][] } {
  const trimmed = text.replace(/^﻿/, ""); // strip BOM
  if (!trimmed.trim()) return { headers: [], rows: [] };
  const firstLine = trimmed.slice(0, trimmed.indexOf("\n") === -1 ? undefined : trimmed.indexOf("\n"));
  const delim = firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";

  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inQuotes) {
      if (c === '"') {
        if (trimmed[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && trimmed[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); if (row.some((v) => v !== "")) rows.push(row); }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

/** Parse a money/number cell: strips currency symbols, thousands separators. */
export function parseMoney(v: string | undefined): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export type ImportMethod = "cash" | "visa" | "instapay" | "mobile_wallet" | "bank_transfer" | "other";

/** Map a free-text method cell onto the payment-method enum. */
export function normalizeMethod(v: string | undefined): ImportMethod | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  if (/cash|كاش|نقد/.test(t)) return "cash";
  if (/visa|card|بطاقة|فيزا|master/.test(t)) return "visa";
  if (/insta/.test(t)) return "instapay";
  if (/wallet|vodafone|محفظة|فودافون/.test(t)) return "mobile_wallet";
  if (/bank|transfer|تحويل|بنك/.test(t)) return "bank_transfer";
  return "other";
}

export interface MappedRow {
  rowIndex: number;
  leadId?: string;
  mrn?: string;
  phone?: string;
  name?: string;
  age?: string;
  patientType?: string;
  source?: string;
  doctorCode?: string;
  doctorName?: string;
  specialtyName?: string;
  serviceCode?: string;
  serviceName?: string;
  serviceDate?: string;
  basePrice: number | null;
  /** Resolved quoted price: price-after-discount, else base − discount. */
  quotedPrice: number | null;
  consumables: number | null;
  doctorPercent: number | null;
  netAfterConsumablesDoctorPercent: number | null;
  amountPaid: number | null;
  method: ImportMethod | null;
  paymentByDoctor: number | null;
  externalPayments: number | null;
  /** Blocking validation errors (row will not import). */
  errors: string[];
  /** Non-blocking notes: mappable-but-unrepresented data (never silently dropped). */
  warnings: string[];
}

function cell(row: string[], headers: string[], mapping: Record<string, CanonicalField | "">, field: CanonicalField): string | undefined {
  const header = Object.keys(mapping).find((h) => mapping[h] === field);
  if (!header) return undefined;
  const idx = headers.indexOf(header);
  return idx >= 0 ? row[idx] : undefined;
}

/** Normalize + validate one source row against a mapping. */
export function mapRow(
  row: string[],
  headers: string[],
  mapping: Record<string, CanonicalField | "">,
  rowIndex: number,
): MappedRow {
  const get = (f: CanonicalField) => cell(row, headers, mapping, f)?.trim() || undefined;
  const base = parseMoney(get("basePrice"));
  const after = parseMoney(get("priceAfterDiscount"));
  const discount = parseMoney(get("discount"));
  const errors: string[] = [];
  const warnings: string[] = [];

  // Resolve quoted price: prefer explicit price-after-discount, else base−discount.
  let quoted: number | null = after;
  if (quoted == null && base != null && discount != null) quoted = Math.max(0, base - discount);
  if (quoted == null && base != null && discount == null) quoted = base; // no discount given

  const leadId = get("leadId");
  const mrn = get("mrn");
  const phone = get("phone");
  if (!leadId && !mrn && !phone && !(get("name") && get("phone"))) errors.push("No match key or new-lead identity (need Lead ID, MRN, phone, or Name + Phone)");
  if (mrn && !/^\d{1,9}$/.test(mrn)) errors.push("MRN must contain 1 to 9 digits");
  if (base == null) errors.push("Missing/invalid service price");
  if (quoted != null && base != null && quoted > base) warnings.push("Quoted exceeds base (surcharge)");
  const consumables = parseMoney(get("consumables"));
  const doctorPercent = parseMoney(get("doctorPercent"));
  const netAfter = parseMoney(get("netAfterConsumablesDoctorPercent"));
  const paymentByDoctor = parseMoney(get("paymentByDoctor"));
  const externalPayments = parseMoney(get("externalPayments"));
  if (consumables != null) warnings.push("Consumables column detected; row will be flagged for review unless mapped to a known consumable component in a later workflow.");
  if (doctorPercent != null || netAfter != null) warnings.push("Doctor compensation formula detected; not silently imported because compensation rules are configured separately.");
  if (paymentByDoctor != null) warnings.push("Payment by doctor detected; review doctor-funded payment classification after import.");
  if (externalPayments != null) warnings.push("External payments detected; review external cost category after import.");

  return {
    rowIndex,
    leadId,
    mrn,
    phone,
    name: get("name"),
    age: get("age"),
    patientType: get("patientType"),
    source: get("source"),
    doctorCode: get("doctorCode"),
    doctorName: get("doctorName"),
    specialtyName: get("specialtyName"),
    serviceCode: get("serviceCode"),
    serviceName: get("serviceName"),
    serviceDate: get("serviceDate"),
    basePrice: base,
    quotedPrice: quoted,
    consumables,
    doctorPercent,
    netAfterConsumablesDoctorPercent: netAfter,
    amountPaid: parseMoney(get("amountPaid")),
    method: normalizeMethod(get("paymentMethod")),
    paymentByDoctor,
    externalPayments,
    errors,
    warnings,
  };
}
