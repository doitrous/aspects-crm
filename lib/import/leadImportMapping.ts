export type LeadImportField =
  | "name"
  | "phone"
  | "mrn"
  | "nationality"
  | "gender"
  | "source"
  | "serviceName"
  | "doctorName"
  | "specialtyName"
  | "age"
  | "patientType"
  | "notes";

export const LEAD_IMPORT_FIELDS: { key: LeadImportField; label: string; required?: boolean }[] = [
  { key: "name", label: "Patient name", required: true },
  { key: "phone", label: "Phone number", required: true },
  { key: "mrn", label: "MRN (1–9 digits)", required: true },
  { key: "nationality", label: "Nationality", required: true },
  { key: "gender", label: "Gender" },
  { key: "source", label: "Lead source" },
  { key: "serviceName", label: "Service" },
  { key: "doctorName", label: "Treating doctor" },
  { key: "specialtyName", label: "Specialty" },
  { key: "age", label: "Age" },
  { key: "patientType", label: "Patient type" },
  { key: "notes", label: "Notes" },
];

const ALIASES: Record<string, LeadImportField> = {
  name: "name", "patient name": "name", "full name": "name", "اسم المريض": "name", "الاسم": "name",
  phone: "phone", mobile: "phone", "phone number": "phone", "phone no": "phone", "رقم الهاتف": "phone", "رقم التليفون": "phone",
  mrn: "mrn", "medical record": "mrn", "medical record number": "mrn", "patient mrn": "mrn", "clinic mrn": "mrn", "رقم الملف": "mrn", "رقم السجل الطبي": "mrn",
  nationality: "nationality", country: "nationality", citizenship: "nationality", "الجنسية": "nationality",
  gender: "gender", sex: "gender", "الجنس": "gender",
  source: "source", "lead source": "source", platform: "source", "المصدر": "source",
  service: "serviceName", "service name": "serviceName", procedure: "serviceName", "الخدمة": "serviceName",
  doctor: "doctorName", "doctor name": "doctorName", "treating doctor": "doctorName", "الطبيب": "doctorName",
  specialty: "specialtyName", speciality: "specialtyName", "specialty name": "specialtyName", "التخصص": "specialtyName",
  age: "age", "patient age": "age", "العمر": "age",
  "patient type": "patientType", "نوع المريض": "patientType",
  notes: "notes", note: "notes", comments: "notes", "الملاحظات": "notes",
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
}

export function autoMapLeadHeaders(headers: string[]): Record<string, LeadImportField | ""> {
  return Object.fromEntries(headers.map((header) => [header, ALIASES[normalizeHeader(header)] ?? ""]));
}

export interface MappedLeadImportRow {
  rowIndex: number;
  name?: string;
  phone?: string;
  mrn?: string;
  nationality?: string;
  gender?: "male" | "female";
  source?: string;
  serviceName?: string;
  doctorName?: string;
  specialtyName?: string;
  age?: number;
  patientType?: string;
  notes?: string;
  errors: string[];
  errorFields: LeadImportField[];
  warnings: string[];
}

function mappedCell(
  row: string[],
  headers: string[],
  mapping: Record<string, LeadImportField | "">,
  field: LeadImportField,
): string | undefined {
  const header = Object.keys(mapping).find((candidate) => mapping[candidate] === field);
  if (!header) return undefined;
  const index = headers.indexOf(header);
  return index >= 0 ? row[index]?.trim() || undefined : undefined;
}

function normalizeGender(value: string | undefined): "male" | "female" | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["male", "m", "ذكر"].includes(normalized)) return "male";
  if (["female", "f", "أنثى", "انثى"].includes(normalized)) return "female";
  return undefined;
}

export function mapLeadImportRow(
  row: string[],
  headers: string[],
  mapping: Record<string, LeadImportField | "">,
  rowIndex: number,
): MappedLeadImportRow {
  const get = (field: LeadImportField) => mappedCell(row, headers, mapping, field);
  const name = get("name");
  const phone = get("phone");
  const mrn = get("mrn");
  const genderRaw = get("gender");
  const ageRaw = get("age");
  const errors: string[] = [];
  const errorFields: LeadImportField[] = [];
  const warnings: string[] = [];
  const addError = (field: LeadImportField, message: string) => { errors.push(message); errorFields.push(field); };
  if (!name) addError("name", "Patient name is required");
  if (!phone) addError("phone", "Phone number is required");
  else if (phone.replace(/\D/g, "").length < 7) addError("phone", "Phone number must contain at least 7 digits");
  if (!mrn) addError("mrn", "MRN is required");
  else if (!/^\d{1,9}$/.test(mrn)) addError("mrn", "MRN must contain 1 to 9 digits");
  const nationality = get("nationality");
  if (!nationality) addError("nationality", "Nationality is required");
  const gender = normalizeGender(genderRaw);
  const parsedAge = ageRaw ? Number(ageRaw) : undefined;
  const age = Number.isInteger(parsedAge) && parsedAge! >= 0 && parsedAge! <= 120 ? parsedAge : undefined;

  return {
    rowIndex,
    name,
    phone,
    mrn,
    nationality,
    gender,
    source: get("source"),
    serviceName: get("serviceName"),
    doctorName: get("doctorName"),
    specialtyName: get("specialtyName"),
    age,
    patientType: get("patientType"),
    notes: get("notes"),
    errors,
    errorFields,
    warnings,
  };
}
