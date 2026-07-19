import "server-only";
import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth/permissions";
import { bookingConfigured, bookingDb } from "@/lib/booking/client";
import { writeActor } from "@/lib/data/actor";
import { supabaseAdmin } from "@/lib/supabase/server";

export class CrmDoctorCatalogError extends Error {}

export interface CrmDoctorCatalogRow {
  id: string;
  nameEn: string;
  nameAr: string;
  specialtyId: string;
  specialtyName: string;
  titleEn: string;
  titleAr: string;
  bioEn: string;
  bioAr: string;
  descriptionEn: string;
  descriptionAr: string;
  photoUrl: string;
  videoUrl: string;
  consultationFee: number | null;
  active: boolean;
  showOnBookingWebsite: boolean;
  featuredOnHomepage: boolean;
  displayOrder: number;
  branchIds: string[];
}

export interface CrmDoctorCatalogOption {
  id: string;
  nameEn: string;
  nameAr: string;
  active: boolean;
}

export interface CrmDoctorCatalogSnapshot {
  configured: boolean;
  migrationReady: boolean;
  doctors: CrmDoctorCatalogRow[];
  specialties: CrmDoctorCatalogOption[];
  branches: CrmDoctorCatalogOption[];
}

export interface SaveCrmDoctorInput {
  id?: string;
  nameEn: string;
  nameAr?: string;
  specialtyId: string;
  titleEn: string;
  titleAr?: string;
  bioEn?: string;
  bioAr?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  photoUrl?: string;
  videoUrl?: string;
  consultationFee?: number | null;
  active: boolean;
  showOnBookingWebsite: boolean;
  featuredOnHomepage: boolean;
  displayOrder: number;
  branchIds: string[];
}

const emptySnapshot: CrmDoctorCatalogSnapshot = {
  configured: false,
  migrationReady: false,
  doctors: [],
  specialties: [],
  branches: [],
};

function missingDoctorMigration(error: { code?: string; message?: string } | null) {
  return error?.code === "42703" || error?.code === "PGRST204" || Boolean(error?.message?.includes("show_on_booking_website"));
}

async function actor() {
  const value = await writeActor();
  assertCan(value.role, "settings.manage");
  return value;
}

async function audit(actorId: string, action: string, doctorId: string, oldValues: Record<string, unknown>, newValues: Record<string, unknown>) {
  const { error } = await supabaseAdmin().from("audit_logs").insert({
    actor_user_id: actorId,
    action,
    entity_type: "booking_doctor",
    entity_id: doctorId,
    old_values: oldValues,
    new_values: newValues,
    metadata: { primary_workspace: "crm", applies_to: ["crm", "admin", "online_booking"] },
  });
  if (error) throw new CrmDoctorCatalogError(`Doctor saved, but its audit record failed: ${error.message}`);
}

function refreshDoctors() {
  revalidatePath("/settings");
  revalidatePath("/calendar");
  revalidatePath("/reservations");
}

export async function crmDoctorCatalogSnapshot(): Promise<CrmDoctorCatalogSnapshot> {
  if (!bookingConfigured()) return emptySnapshot;
  const db = bookingDb();
  const [doctors, specialties, branches, assignments] = await Promise.all([
    db.from("doctors").select("id,name_en,name_ar,specialty_id,title_en,title_ar,bio_en,bio_ar,description_en,description_ar,photo_url,video_url,consultation_fee,is_active,show_on_booking_website,featured_on_homepage,display_order").order("display_order").order("name_en"),
    db.from("specialties").select("id,name_en,name_ar,is_active").order("display_order").order("name_en"),
    db.from("branches").select("id,name_en,name_ar,is_active").order("display_order").order("name_en"),
    db.from("doctor_branch_assignments").select("doctor_id,branch_id,is_active").eq("is_active", true),
  ]);

  if (missingDoctorMigration(doctors.error)) return { ...emptySnapshot, configured: true };
  for (const response of [doctors, specialties, branches, assignments]) {
    if (response.error) throw new CrmDoctorCatalogError(`Could not read the shared doctor catalog: ${response.error.message}`);
  }

  type DoctorDb = {
    id: string; name_en: string; name_ar: string; specialty_id: string; title_en: string; title_ar: string;
    bio_en: string | null; bio_ar: string | null; description_en: string | null; description_ar: string | null;
    photo_url: string | null; video_url: string | null; consultation_fee: number | null; is_active: boolean;
    show_on_booking_website: boolean; featured_on_homepage: boolean; display_order: number;
  };
  type OptionDb = { id: string; name_en: string; name_ar: string; is_active: boolean };
  type AssignmentDb = { doctor_id: string; branch_id: string; is_active: boolean };
  const specialtyRows = (specialties.data ?? []) as OptionDb[];
  const specialtyNames = new Map(specialtyRows.map((row) => [row.id, row.name_en]));
  const assignmentRows = (assignments.data ?? []) as AssignmentDb[];
  const option = (row: OptionDb): CrmDoctorCatalogOption => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar, active: row.is_active });

  return {
    configured: true,
    migrationReady: true,
    doctors: ((doctors.data ?? []) as DoctorDb[]).map((row) => ({
      id: row.id,
      nameEn: row.name_en,
      nameAr: row.name_ar,
      specialtyId: row.specialty_id,
      specialtyName: specialtyNames.get(row.specialty_id) ?? "Unknown specialty",
      titleEn: row.title_en,
      titleAr: row.title_ar,
      bioEn: row.bio_en ?? "",
      bioAr: row.bio_ar ?? "",
      descriptionEn: row.description_en ?? "",
      descriptionAr: row.description_ar ?? "",
      photoUrl: row.photo_url ?? "",
      videoUrl: row.video_url ?? "",
      consultationFee: row.consultation_fee,
      active: row.is_active,
      showOnBookingWebsite: row.show_on_booking_website,
      featuredOnHomepage: row.featured_on_homepage,
      displayOrder: row.display_order,
      branchIds: assignmentRows.filter((assignment) => assignment.doctor_id === row.id).map((assignment) => assignment.branch_id),
    })),
    specialties: specialtyRows.map(option),
    branches: ((branches.data ?? []) as OptionDb[]).map(option),
  };
}

export async function saveCrmDoctor(input: SaveCrmDoctorInput): Promise<{ id: string; name: string }> {
  const currentActor = await actor();
  if (!bookingConfigured()) throw new CrmDoctorCatalogError("Booking platform is not configured.");

  const snapshot = await crmDoctorCatalogSnapshot();
  if (!snapshot.migrationReady) throw new CrmDoctorCatalogError("Apply booking migration 023_crm_doctor_catalog.sql before managing doctors.");
  const nameEn = input.nameEn.trim();
  const titleEn = input.titleEn.trim();
  if (!nameEn) throw new CrmDoctorCatalogError("Doctor name is required.");
  if (!titleEn) throw new CrmDoctorCatalogError("Doctor title is required.");
  if (!snapshot.specialties.some((specialty) => specialty.id === input.specialtyId && specialty.active)) throw new CrmDoctorCatalogError("Choose a valid active specialty.");

  const branchIds = [...new Set(input.branchIds)].filter((branchId) => snapshot.branches.some((branch) => branch.id === branchId && branch.active));
  if (branchIds.length === 0) throw new CrmDoctorCatalogError("Choose at least one active branch.");
  if (!Number.isInteger(input.displayOrder)) throw new CrmDoctorCatalogError("Display order must be a whole number.");
  if (input.consultationFee !== null && input.consultationFee !== undefined && (!Number.isFinite(input.consultationFee) || input.consultationFee < 0)) {
    throw new CrmDoctorCatalogError("Consultation fee must be zero or greater.");
  }

  const db = bookingDb();
  const oldDoctor = input.id ? snapshot.doctors.find((doctor) => doctor.id === input.id) : undefined;
  if (input.id && !oldDoctor) throw new CrmDoctorCatalogError("Doctor not found.");
  const patch = {
    name_en: nameEn,
    name_ar: input.nameAr?.trim() || nameEn,
    specialty_id: input.specialtyId,
    title_en: titleEn,
    title_ar: input.titleAr?.trim() || titleEn,
    bio_en: input.bioEn?.trim() || null,
    bio_ar: input.bioAr?.trim() || null,
    description_en: input.descriptionEn?.trim() || null,
    description_ar: input.descriptionAr?.trim() || null,
    photo_url: input.photoUrl?.trim() || null,
    video_url: input.videoUrl?.trim() || null,
    consultation_fee: input.consultationFee ?? null,
    is_active: input.active,
    show_on_booking_website: input.showOnBookingWebsite,
    featured_on_homepage: input.featuredOnHomepage,
    display_order: input.displayOrder,
  };

  const saved = input.id
    ? await db.from("doctors").update(patch).eq("id", input.id).select("id").single<{ id: string }>()
    : await db.from("doctors").insert(patch).select("id").single<{ id: string }>();
  if (saved.error || !saved.data) throw new CrmDoctorCatalogError(saved.error?.message ?? "Could not save doctor.");

  const doctorId = saved.data.id;
  const existingAssignments = snapshot.doctors.find((doctor) => doctor.id === doctorId)?.branchIds ?? [];
  const unselected = existingAssignments.filter((branchId) => !branchIds.includes(branchId));
  if (unselected.length > 0) {
    const { error } = await db.from("doctor_branch_assignments").update({ is_active: false }).eq("doctor_id", doctorId).in("branch_id", unselected);
    if (error) throw new CrmDoctorCatalogError(`Doctor saved, but branch assignments could not be updated: ${error.message}`);
  }
  const { error: assignmentError } = await db.from("doctor_branch_assignments").upsert(
    branchIds.map((branchId) => ({ doctor_id: doctorId, branch_id: branchId, is_active: true })),
    { onConflict: "doctor_id,branch_id" },
  );
  if (assignmentError) throw new CrmDoctorCatalogError(`Doctor saved, but branch assignments could not be updated: ${assignmentError.message}`);

  await audit(currentActor.id, input.id ? "booking.doctor_updated" : "booking.doctor_created", doctorId, oldDoctor ? { ...oldDoctor } : {}, { ...patch, branch_ids: branchIds });
  refreshDoctors();
  return { id: doctorId, name: nameEn };
}

export async function deleteCrmDoctor(id: string): Promise<void> {
  const currentActor = await actor();
  if (!bookingConfigured()) throw new CrmDoctorCatalogError("Booking platform is not configured.");
  const snapshot = await crmDoctorCatalogSnapshot();
  const doctor = snapshot.doctors.find((row) => row.id === id);
  if (!doctor) throw new CrmDoctorCatalogError("Doctor not found.");
  const { error } = await bookingDb().from("doctors").delete().eq("id", id);
  if (error) throw new CrmDoctorCatalogError(`Could not delete doctor. Deactivate the doctor if existing records still reference them. ${error.message}`);
  await audit(currentActor.id, "booking.doctor_deleted", id, { ...doctor }, {});
  refreshDoctors();
}
