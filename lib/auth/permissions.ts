/**
 * Centralized permission matrix (spec §5, §21).
 *
 * The SINGLE source of truth for "who may do what". Every server action, API
 * route, and UI guard must derive its decision from {@link can} / {@link assertCan}
 * here — never from an inline role string comparison and never from a role value
 * the browser submitted (always resolve the caller's role from the authenticated
 * session on the server, then pass it in).
 *
 * Roles are the app-level {@link Role}. The live `crm_users.role` enum
 * (`owner_admin | manager | moderator | doctor | viewer | auditor`) is mapped
 * onto these by {@link normalizeRole} so the matrix has one small key space.
 *
 * Pure module: no I/O, no session lookup. Callers own authentication; this owns
 * authorization.
 */

import type { Role } from "@/lib/types";

/** Every gated action in the CRM. Extend here, not with ad-hoc string checks. */
export type Capability =
  // ── financial source of truth (§5) ──────────────────────────
  | "financial.view" // see the Payments/Financials tab + reports
  | "financial.editLeadRecord" // enter quoted price, payments, consumables on a lead
  | "financial.editRules" // change service prices, discount rules, comp rules, bundles
  | "financial.forceExceptionalPrice" // override a below-allowed quote (§1B)
  | "financial.approveDiscount" // resolve exceptional-discount escalations (§4)
  | "financial.viewReports" // cash-flow / profitability reports (§14)
  | "financial.bulkImport" // bulk import into the source-of-truth tables (§17)
  // ── users & role management (§21) ───────────────────────────
  | "users.view" // see the Users tab
  | "users.changeRole" // change another user's role
  | "users.activate" // activate / deactivate a user
  | "users.invite" // create / invite a new user
  // ── settings & configuration (§C) ───────────────────────────
  | "settings.view" // open the Settings area
  | "settings.manage" // edit tags, lost reasons, SLA, follow-up rules, target CPL, AI prompt
  // ── auditor reporting (§A/§B) ───────────────────────────────
  | "reports.view" // open Auditor Dashboard + Reports
  | "reports.generate" // generate / override / finalize a daily audit report
  | "reports.createOwn" // moderators create their own daily and follow-up reports
  // ── email automation (§D/§E) ────────────────────────────────
  | "email.view" // open the Emails log
  | "email.manage" // create / edit email rules
  // ── audit ───────────────────────────────────────────────────
  | "audit.view" // read financial + role-change audit logs
  | "leads.edit" // mutate lead stage, tags, notes, follow-ups and escalations
  | "leads.delete"; // permanently delete individual/all leads (admin + auditor only)

/**
 * Capability grants per role. Absent = denied. This is the whole authorization
 * model in one table — read it top to bottom to know exactly what each role can
 * do.
 *
 * Financial edits (rules AND lead records) are granted to BOTH admin and auditor
 * per §5. User *role changes* and *invitations* are admin-only (auditor may view
 * the Users tab and audit trail but not mutate access) — the safest reading of
 * §21's separation of duties.
 */
const MATRIX: Record<Role, ReadonlySet<Capability>> = {
  admin: new Set<Capability>([
    "financial.view",
    "financial.editLeadRecord",
    "financial.editRules",
    "financial.forceExceptionalPrice",
    "financial.approveDiscount",
    "financial.viewReports",
    "financial.bulkImport",
    "users.view",
    "users.changeRole",
    "users.activate",
    "users.invite",
    "settings.view",
    "settings.manage",
    "reports.view",
    "reports.generate",
    "reports.createOwn",
    "email.view",
    "email.manage",
    "audit.view",
    "leads.edit",
    "leads.delete",
  ]),
  auditor: new Set<Capability>([
    "financial.view",
    "financial.editLeadRecord",
    "financial.editRules",
    "financial.forceExceptionalPrice",
    "financial.approveDiscount",
    "financial.viewReports",
    "financial.bulkImport",
    "users.view",
    // The auditor owns operational configuration and the daily review workflow
    // (§C/§A): they may manage tags, lost reasons, follow-up rules etc., run and
    // finalize reports, and manage email rules — but not change user access.
    "settings.view",
    "settings.manage",
    "reports.view",
    "reports.generate",
    "reports.createOwn",
    "email.view",
    "email.manage",
    "audit.view",
    "leads.edit",
    "leads.delete",
  ]),
  moderator: new Set<Capability>([
    // Operational only: may record a lead's agreed price / payments, and may
    // *request* an exceptional price via escalation — but cannot change pricing
    // rules or approve exceptions.
    "financial.view",
    "financial.editLeadRecord",
    "reports.view",
    "reports.createOwn",
    "leads.edit",
  ]),
  viewer: new Set<Capability>([
    "financial.view",
  ]),
};

/** Map the live `crm_users.role` enum onto an app-level {@link Role}. */
export function normalizeRole(dbRole: string | null | undefined): Role {
  switch (dbRole) {
    case "owner_admin":
    case "manager":
    case "admin":
      return "admin";
    case "auditor":
      return "auditor";
    case "moderator":
      return "moderator";
    // doctor / viewer / unknown → least privilege
    default:
      return "viewer";
  }
}

/** True when `role` is granted `capability`. */
export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role]?.has(capability) ?? false;
}

/** Error thrown by {@link assertCan}; carries the role + capability for logging. */
export class PermissionError extends Error {
  constructor(
    readonly role: Role,
    readonly capability: Capability,
  ) {
    super(`Role "${role}" is not permitted to "${capability}"`);
    this.name = "PermissionError";
  }
}

/** Throw {@link PermissionError} unless `role` is granted `capability`. */
export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) throw new PermissionError(role, capability);
}

/* ── lockout protection (§21) ─────────────────────────────────── */

/** Minimal shape needed to reason about account-lockout safety. */
export interface AccountRef {
  id: string;
  role: Role;
  isActive: boolean;
}

/** Count of currently active admins in a set of accounts. */
function activeAdminCount(accounts: AccountRef[]): number {
  return accounts.filter((a) => a.role === "admin" && a.isActive).length;
}

export interface RoleChangeAttempt {
  /** The authenticated user performing the change. */
  actor: AccountRef;
  /** The account being modified. */
  target: AccountRef;
  /** Desired new role (for a role change), or omit for activate/deactivate. */
  newRole?: Role;
  /** Desired active state (for activate/deactivate), or omit for a role change. */
  newActive?: boolean;
  /** All CRM accounts, used to enforce "keep at least one active admin". */
  allAccounts: AccountRef[];
}

export interface GuardResult {
  ok: boolean;
  /** Machine-readable reason when `ok === false`. */
  reason?:
    | "not_permitted"
    | "moderator_self_role_change"
    | "self_deactivate"
    | "last_active_admin";
}

/**
 * Guard a role change or activation toggle against every lockout rule (§21):
 *  - the actor must hold the relevant capability;
 *  - a moderator may never change their own role;
 *  - a user may not deactivate their own account;
 *  - the final remaining active admin may not be demoted or deactivated.
 *
 * Pure and defensive — call this on the server BEFORE writing, in addition to
 * the {@link assertCan} capability check.
 */
export function guardRoleChange(attempt: RoleChangeAttempt): GuardResult {
  const { actor, target, newRole, newActive, allAccounts } = attempt;

  const isRoleChange = newRole !== undefined && newRole !== target.role;
  const isDeactivation = newActive === false && target.isActive;

  // Capability check (role changes and activation are admin-only per matrix).
  const needed: Capability = newRole !== undefined ? "users.changeRole" : "users.activate";
  if (!can(actor.role, needed)) return { ok: false, reason: "not_permitted" };

  // A moderator must never change their own role (defense-in-depth; a moderator
  // also lacks the capability above, but this is explicit per §21).
  if (isRoleChange && actor.id === target.id && actor.role === "moderator") {
    return { ok: false, reason: "moderator_self_role_change" };
  }

  // No self-deactivation.
  if (isDeactivation && actor.id === target.id) {
    return { ok: false, reason: "self_deactivate" };
  }

  // Protect the last active admin from demotion or deactivation.
  const targetIsActiveAdmin = target.role === "admin" && target.isActive;
  if (targetIsActiveAdmin) {
    const demoting = isRoleChange && newRole !== "admin";
    const deactivating = isDeactivation;
    if ((demoting || deactivating) && activeAdminCount(allAccounts) <= 1) {
      return { ok: false, reason: "last_active_admin" };
    }
  }

  return { ok: true };
}
