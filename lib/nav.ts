import type { Role } from "@/lib/types";

export interface NavItem {
  label: string;
  /** i18n key resolved by the sidebar; falls back to `label`. */
  i18nKey: string;
  href: string;
  icon: string;
  /** Roles allowed to see this item. Empty = everyone. */
  roles?: Role[];
  countKey?: string; // key into a counts map for the badge
}

export const NAV: NavItem[] = [
  { label: "Dashboard", i18nKey: "nav.dashboard", href: "/dashboard", icon: "◱" },
  { label: "New Leads", i18nKey: "nav.newLeads", href: "/leads", icon: "✦", countKey: "newLeads" },
  { label: "Database Leads", i18nKey: "nav.database", href: "/database", icon: "▤" },
  { label: "Follow-Up", i18nKey: "nav.followUp", href: "/follow-up", icon: "↻", countKey: "followUp" },
  { label: "Duplicates", i18nKey: "nav.duplicates", href: "/duplicates", icon: "⧉", countKey: "duplicates" },
  { label: "Escalations", i18nKey: "nav.escalations", href: "/escalations", icon: "⚑", countKey: "escalations" },
  { label: "Patient Reservations", i18nKey: "nav.reservations", href: "/reservations", icon: "🧾", countKey: "reservations" },
  { label: "Calendar", i18nKey: "nav.calendar", href: "/calendar", icon: "📅" },
  { label: "Financial", i18nKey: "nav.financial", href: "/financial", icon: "₤", roles: ["auditor", "admin"] },
  { label: "Auditor", i18nKey: "nav.auditor", href: "/auditor", icon: "✓", roles: ["auditor", "admin"] },
  { label: "Reports", i18nKey: "nav.reports", href: "/reports", icon: "▦", roles: ["auditor", "admin"] },
  { label: "Emails", i18nKey: "nav.emails", href: "/emails", icon: "✉", roles: ["admin", "auditor"] },
  { label: "Activity Log", i18nKey: "nav.activity", href: "/activity", icon: "≣", roles: ["admin", "auditor"] },
  // Mirrors the `users.view` capability: auditors may read the roster + history,
  // only admins may mutate access — enforced server-side, not by this list.
  { label: "Users & Roles", i18nKey: "nav.users", href: "/settings/users", icon: "👥", roles: ["admin", "auditor"] },
  // Auditors own operational configuration (§C); admins additionally manage users.
  { label: "Settings", i18nKey: "nav.settings", href: "/settings", icon: "⚙", roles: ["admin", "auditor"] },
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
