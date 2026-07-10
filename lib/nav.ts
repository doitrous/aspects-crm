import type { Role } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  /** Roles allowed to see this item. Empty = everyone. */
  roles?: Role[];
  countKey?: string; // key into a counts map for the badge
}

export const NAV: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "◱" },
  { label: "New Leads", href: "/leads", icon: "✦", countKey: "newLeads" },
  { label: "Database Leads", href: "/database", icon: "▤" },
  { label: "Follow-Up", href: "/follow-up", icon: "↻", countKey: "followUp" },
  { label: "Duplicates", href: "/duplicates", icon: "⧉", countKey: "duplicates" },
  { label: "Escalations", href: "/escalations", icon: "⚑", countKey: "escalations" },
  { label: "Patient Reservations", href: "/reservations", icon: "🧾", countKey: "reservations" },
  { label: "Calendar", href: "/calendar", icon: "📅" },
  { label: "Auditor", href: "/auditor", icon: "✓", roles: ["auditor", "admin"] },
  { label: "Reports", href: "/reports", icon: "▦", roles: ["auditor", "admin"] },
  { label: "Settings", href: "/settings", icon: "⚙", roles: ["admin"] },
];

export function visibleNav(role: Role): NavItem[] {
  return NAV.filter((n) => !n.roles || n.roles.includes(role));
}
