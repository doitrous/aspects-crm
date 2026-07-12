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
  section: "workspace" | "intake" | "pipeline" | "care" | "data" | "operations" | "finance" | "quality" | "administration";
}

export const NAV_SECTION_LABELS: Record<NavItem["section"], string> = {
  workspace: "Workspace", intake: "Intake", pipeline: "Pipeline", care: "Care",
  data: "Data", operations: "Operations", finance: "Finance", quality: "Quality",
  administration: "Administration",
};

export const NAV: NavItem[] = [
  { label: "Calendar", i18nKey: "nav.calendar", href: "/calendar", icon: "📅", section: "workspace" },
  { label: "New Leads", i18nKey: "nav.newLeads", href: "/leads", icon: "✦", countKey: "newLeads", section: "intake" },
  { label: "Website Reservations", i18nKey: "nav.reservations", href: "/reservations", icon: "🧾", countKey: "reservations", section: "intake" },
  { label: "Qualified Leads", i18nKey: "nav.qualified", href: "/qualified", icon: "✓", countKey: "qualified", section: "pipeline" },
  { label: "Booked Leads", i18nKey: "nav.booked", href: "/booked", icon: "▣", countKey: "booked", section: "pipeline" },
  { label: "Lost Leads", i18nKey: "nav.lost", href: "/lost", icon: "×", countKey: "lost", section: "pipeline" },
  { label: "Follow-Up", i18nKey: "nav.followUp", href: "/follow-up", icon: "↻", countKey: "followUp", section: "care" },
  { label: "Post-Op F/U", i18nKey: "nav.postOp", href: "/post-op", icon: "◌", section: "care" },
  { label: "Database", i18nKey: "nav.database", href: "/database", icon: "▤", section: "data" },
  { label: "Bulk Import", i18nKey: "nav.bulkImport", href: "/bulk-import", icon: "⇪", roles: ["auditor", "admin"], section: "data" },
  { label: "Duplicates", i18nKey: "nav.duplicates", href: "/duplicates", icon: "⧉", countKey: "duplicates", section: "operations" },
  { label: "Escalations", i18nKey: "nav.escalations", href: "/escalations", icon: "⚑", countKey: "escalations", section: "operations" },
  { label: "Financial", i18nKey: "nav.financial", href: "/financial", icon: "₤", roles: ["auditor", "admin"], section: "finance" },
  { label: "Auditor", i18nKey: "nav.auditor", href: "/auditor", icon: "✓", roles: ["auditor", "admin"], section: "quality" },
  { label: "Reports", i18nKey: "nav.reports", href: "/reports", icon: "▦", roles: ["moderator", "auditor", "admin"], section: "quality" },
  { label: "Emails", i18nKey: "nav.emails", href: "/emails", icon: "✉", roles: ["admin", "auditor"], section: "administration" },
  // Auditors own operational configuration (§C); admins additionally manage users.
  { label: "Settings", i18nKey: "nav.settings", href: "/settings", icon: "⚙", roles: ["admin", "auditor"], section: "administration" },
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
