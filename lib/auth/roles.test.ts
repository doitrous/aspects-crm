import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeRole } from "./permissions";
import { ASSIGNABLE_ROLES, dbRoleFor, guardMessage, isAssignableRole } from "./roles";

test("granting admin writes `manager`, never minting a new owner_admin", () => {
  assert.equal(dbRoleFor("admin", "moderator"), "manager");
  assert.equal(dbRoleFor("admin", "viewer"), "manager");
  assert.equal(dbRoleFor("admin", null), "manager");
});

test("re-granting admin to the owner keeps owner_admin, never demoting them", () => {
  assert.equal(dbRoleFor("admin", "owner_admin"), "owner_admin");
});

test("non-admin roles map onto the crm_role enum verbatim", () => {
  assert.equal(dbRoleFor("auditor", "moderator"), "auditor");
  assert.equal(dbRoleFor("moderator", "manager"), "moderator");
  assert.equal(dbRoleFor("viewer", "auditor"), "viewer");
});

test("every value dbRoleFor writes normalizes back to the role that was asked for", () => {
  const currents = ["owner_admin", "manager", "moderator", "auditor", "viewer", null];
  for (const role of ["admin", "auditor", "moderator", "viewer"] as const) {
    for (const current of currents) {
      const written = dbRoleFor(role, current);
      assert.equal(
        normalizeRole(written),
        role,
        `dbRoleFor(${role}, ${current}) wrote "${written}" which normalizes to "${normalizeRole(written)}"`,
      );
    }
  }
});

test("demoting an owner_admin away from admin actually demotes them", () => {
  assert.equal(dbRoleFor("moderator", "owner_admin"), "moderator");
  assert.equal(normalizeRole(dbRoleFor("moderator", "owner_admin")), "moderator");
});

test("only admin, auditor and moderator are assignable from the UI", () => {
  assert.deepEqual([...ASSIGNABLE_ROLES], ["admin", "auditor", "moderator"]);
  assert.equal(isAssignableRole("admin"), true);
  assert.equal(isAssignableRole("viewer"), false);
  assert.equal(isAssignableRole("owner_admin"), false);
  assert.equal(isAssignableRole("doctor"), false);
});

test("every guard rejection has human-readable text", () => {
  const reasons = [
    "not_permitted",
    "moderator_self_role_change",
    "self_deactivate",
    "last_active_admin",
  ] as const;
  for (const r of reasons) {
    assert.ok(guardMessage(r).length > 0, `${r} has no message`);
  }
});
