"use server";

import { CrmDoctorCatalogError, deleteCrmDoctor, saveCrmDoctor } from "@/lib/booking/doctors";

export interface DoctorActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

const str = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const failure = (error: unknown): DoctorActionState => ({
  ok: false,
  error: error instanceof CrmDoctorCatalogError ? error.message : "The doctor catalog change failed.",
});

export async function saveDoctorAction(_: DoctorActionState, data: FormData): Promise<DoctorActionState> {
  const fee = str(data, "consultationFee");
  try {
    const result = await saveCrmDoctor({
      id: str(data, "id") || undefined,
      nameEn: str(data, "nameEn"),
      nameAr: str(data, "nameAr"),
      specialtyId: str(data, "specialtyId"),
      titleEn: str(data, "titleEn"),
      titleAr: str(data, "titleAr"),
      bioEn: str(data, "bioEn"),
      bioAr: str(data, "bioAr"),
      descriptionEn: str(data, "descriptionEn"),
      descriptionAr: str(data, "descriptionAr"),
      photoUrl: str(data, "photoUrl"),
      videoUrl: str(data, "videoUrl"),
      consultationFee: fee ? Number(fee) : null,
      active: data.get("active") === "on",
      showOnBookingWebsite: data.get("showOnBookingWebsite") === "on",
      featuredOnHomepage: data.get("featuredOnHomepage") === "on",
      displayOrder: Number(str(data, "displayOrder") || 0),
      branchIds: data.getAll("branchIds").map(String),
    });
    return { ok: true, message: `${result.name} saved in the shared doctor catalog.` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDoctorAction(_: DoctorActionState, data: FormData): Promise<DoctorActionState> {
  try {
    await deleteCrmDoctor(str(data, "id"));
    return { ok: true, message: "Doctor deleted from the shared catalog." };
  } catch (error) {
    return failure(error);
  }
}
