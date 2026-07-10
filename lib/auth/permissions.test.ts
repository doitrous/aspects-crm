import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertCan,
  can,
  guardRoleChange,
  normalizeRole,
  PermissionError,
  type AccountRef,
} from "./permissions";

/* ── role normalization ──────────────────────────────────────── */

test("normalizeRole maps DB enum onto app roles", () => {
  assert.equal(normalizeRole("owner_admin"), "admin");
  assert.equal(normalizeRole("manager"), "admin");
  assert.equal(normalizeRole("auditor"), "auditor");
  assert.equal(normalizeRole("moderator"), "moderator");
  assert.equal(normalizeRole("doctor"), "viewer");
  assert.equal(normalizeRole("viewer"), "viewer");
  assert.equal(normalizeRole(null), "viewer"); // least privilege
  assert.equal(normalizeRole("nonsense"), "viewer");
});

/* ── capability matrix (§5) ──────────────────────────────────── */

test("admin and auditor may edit financial rules; moderator may not", () => {
  assert.equal(can("admin", "financial.editRules"), true);
  assert.equal(can("auditor", "financial.editRules"), true);
  assert.equal(can("moderator", "financial.editRules"), false);
  assert.equal(can("viewer", "financial.editRules"), false);
});

test("moderator may edit a lead's financial record but not approve/force", () => {
  assert.equal(can("moderator", "financial.editLeadRecord"), true);
  assert.equal(can("moderator", "financial.forceExceptionalPrice"), false);
  assert.equal(can("moderator", "financial.approveDiscount"), false);
});

test("both admin and auditor may force exceptional price and approve discounts", () => {
  for (const role of ["admin", "auditor"] as const) {
    assert.equal(can(role, "financial.forceExceptionalPrice"), true);
    assert.equal(can(role, "financial.approveDiscount"), true);
  }
});

test("user role changes and invites are admin-only; auditor may only view", () => {
  assert.equal(can("admin", "users.changeRole"), true);
  assert.equal(can("admin", "users.invite"), true);
  assert.equal(can("auditor", "users.view"), true);
  assert.equal(can("auditor", "users.changeRole"), false);
  assert.equal(can("auditor", "users.invite"), false);
  assert.equal(can("moderator", "users.view"), false);
});

test("viewer can only view financials, nothing mutating", () => {
  assert.equal(can("viewer", "financial.view"), true);
  assert.equal(can("viewer", "financial.editLeadRecord"), false);
  assert.equal(can("viewer", "audit.view"), false);
});

test("assertCan throws PermissionError when denied, is silent when allowed", () => {
  assert.throws(() => assertCan("moderator", "financial.editRules"), PermissionError);
  assert.doesNotThrow(() => assertCan("admin", "financial.editRules"));
});

/* ── lockout protection (§21) ────────────────────────────────── */

const admin1: AccountRef = { id: "a1", role: "admin", isActive: true };
const admin2: AccountRef = { id: "a2", role: "admin", isActive: true };
const mod1: AccountRef = { id: "m1", role: "moderator", isActive: true };
const auditor1: AccountRef = { id: "au1", role: "auditor", isActive: true };

test("moderator cannot change their own role", () => {
  const r = guardRoleChange({
    actor: mod1,
    target: mod1,
    newRole: "admin",
    allAccounts: [admin1, mod1],
  });
  assert.equal(r.ok, false);
  // moderator lacks users.changeRole, so it fails at the capability gate first
  assert.equal(r.reason, "not_permitted");
});

test("non-admin cannot change roles at all", () => {
  const r = guardRoleChange({
    actor: auditor1,
    target: mod1,
    newRole: "admin",
    allAccounts: [admin1, mod1, auditor1],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not_permitted");
});

test("last active admin cannot be demoted", () => {
  const r = guardRoleChange({
    actor: admin1,
    target: admin1,
    newRole: "moderator",
    allAccounts: [admin1, mod1],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "last_active_admin");
});

test("an admin CAN be demoted when another active admin remains", () => {
  const r = guardRoleChange({
    actor: admin1,
    target: admin2,
    newRole: "moderator",
    allAccounts: [admin1, admin2, mod1],
  });
  assert.equal(r.ok, true);
});

test("the sole active admin cannot be deactivated (by another admin)", () => {
  // A second admin who is already inactive still holds the admin capability by
  // role, but only admin1 is active — so deactivating admin1 would lock everyone
  // out and must be refused.
  const inactiveAdmin: AccountRef = { id: "a2", role: "admin", isActive: false };
  const r = guardRoleChange({
    actor: inactiveAdmin,
    target: admin1,
    newActive: false,
    allAccounts: [admin1, inactiveAdmin, mod1],
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "last_active_admin");
});

test("a user cannot deactivate their own account", () => {
  const r = guardRoleChange({
    actor: admin1,
    target: admin1,
    newActive: false,
    allAccounts: [admin1, admin2],
  });
  // self-deactivation is blocked before the last-admin check
  assert.equal(r.ok, false);
  assert.equal(r.reason, "self_deactivate");
});

test("admin may deactivate a different admin when others remain", () => {
  const r = guardRoleChange({
    actor: admin1,
    target: admin2,
    newActive: false,
    allAccounts: [admin1, admin2],
  });
  assert.equal(r.ok, true);
});

test("promoting a moderator to admin is allowed for an admin actor", () => {
  const r = guardRoleChange({
    actor: admin1,
    target: mod1,
    newRole: "admin",
    allAccounts: [admin1, mod1],
  });
  assert.equal(r.ok, true);
});
