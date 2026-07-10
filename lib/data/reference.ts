import type { Campaign, Doctor, Specialty } from "@/lib/types";

export const specialties: Specialty[] = [];
export const doctors: Doctor[] = [];
export const campaigns: Campaign[] = [];

export const sources = [
  { id: "facebook", name: "Facebook" },
  { id: "instagram", name: "Instagram" },
  { id: "whatsapp", name: "WhatsApp" },
  { id: "web", name: "Website" },
  { id: "referral", name: "Referral" },
  { id: "walk_in", name: "Walk-in" },
  { id: "phone", name: "Phone" },
];

// NOTE: the operator list lives in the `crm_users` table, not here. Resolve the
// signed-in user with `lib/data/session.ts`; there is deliberately no mock
// `currentUser` to fall back on.

export function doctorName(id?: string): string {
  return id ?? "—";
}
export function specialtyName(id?: string): string {
  return id ?? "—";
}
export function campaignName(id?: string): string {
  return id ?? "—";
}
export function sourceName(id?: string): string {
  return sources.find((s) => s.id === id)?.name ?? "—";
}
