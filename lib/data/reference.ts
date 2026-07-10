import type { Campaign, Doctor, Specialty, User } from "@/lib/types";

export const specialties: Specialty[] = [
  { id: "derm", name: "Dermatology" },
  { id: "laser", name: "Laser & Hair Removal" },
  { id: "aesthetic", name: "Aesthetic & Fillers" },
  { id: "plastic", name: "Plastic Surgery" },
  { id: "skincare", name: "Medical Skincare" },
];

export const doctors: Doctor[] = [
  { id: "dr-hana", name: "Dr. Hana Fawzy", specialtyIds: ["derm", "skincare"], rating: 4.9, branch: "New Cairo" },
  { id: "dr-omar", name: "Dr. Omar Reda", specialtyIds: ["laser"], rating: 4.8, branch: "New Cairo" },
  { id: "dr-salma", name: "Dr. Salma Adel", specialtyIds: ["aesthetic", "derm"], rating: 4.9, branch: "Zamalek" },
  { id: "dr-karim", name: "Dr. Karim Nabil", specialtyIds: ["plastic"], rating: 4.7, branch: "Zamalek" },
];

export const campaigns: Campaign[] = [
  { id: "cmp-summer-laser", name: "Summer Laser Offer", source: "facebook" },
  { id: "cmp-filler-ig", name: "Filler Promo (IG)", source: "instagram" },
  { id: "cmp-acne", name: "Acne Program", source: "facebook" },
  { id: "cmp-wa-broadcast", name: "WhatsApp Broadcast", source: "whatsapp" },
  { id: "cmp-organic", name: "Organic / Direct", source: "web" },
];

export const sources = [
  { id: "facebook", name: "Facebook" },
  { id: "instagram", name: "Instagram" },
  { id: "whatsapp", name: "WhatsApp" },
  { id: "web", name: "Website" },
  { id: "referral", name: "Referral" },
  { id: "walk_in", name: "Walk-in" },
  { id: "phone", name: "Phone" },
];

export const users: User[] = [
  { id: "u-mona", name: "Mona Khaled", role: "moderator", initials: "MK" },
  { id: "u-nour", name: "Nour Hassan", role: "moderator", initials: "NH" },
  { id: "u-yara", name: "Yara Samir", role: "auditor", initials: "YS" },
  { id: "u-admin", name: "Admin", role: "admin", initials: "AD" },
];

export const currentUser: User = users[0]; // Mona Khaled — moderator (matches prototype)

export function doctorName(id?: string): string {
  return doctors.find((d) => d.id === id)?.name ?? "—";
}
export function specialtyName(id?: string): string {
  return specialties.find((s) => s.id === id)?.name ?? "—";
}
export function campaignName(id?: string): string {
  return campaigns.find((c) => c.id === id)?.name ?? "—";
}
export function sourceName(id?: string): string {
  return sources.find((s) => s.id === id)?.name ?? "—";
}
