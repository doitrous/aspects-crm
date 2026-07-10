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
  // Mirrors the `users.view` capability: auditors may read the roster + history,
  // only admins may mutate access — enforced server-side, not by this list.
  { label: "Users & Roles", href: "/settings/users", icon: "👥", roles: ["admin", "auditor"] },
  { label: "Settings", href: "/settings", icon: "⚙", roles: ["admin"] },
];

/** Does `pathname` sit at or beneath `href`? `/settings` does not match `/settingsx`. */
function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The href of the single nav item that should render as active, or `null`.
 *
 * The most *specific* match wins, so `/settings/users` highlights "Users & Roles"
 * rather than lighting up both it and its "/settings" ancestor.
 */
export function activeHref(pathname: string, items: NavItem[] = NAV): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (!matches(pathname, item.href)) continue;
    if (best === null || item.href.length > best.length) best = item.href;
  }
  return best;
}

export function visibleNav(role: Role): NavItem[] {
  return NAV.filter((n) => !n.roles || n.roles.includes(role));
}
