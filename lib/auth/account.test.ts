import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canImpersonate, initialsOf, toSessionUser, type CrmUserRow } from "./account";

function row(over: Partial<CrmUserRow> = {}): CrmUserRow {
  return {
    id: "u1",
    email: "mona@aspects.clinic",
    full_name: "Mona Khaled",
    role: "moderator",
    is_active: true,
    auth_user_id: "auth-1",
    ...over,
  };
}

/* ── initials ─────────────────────────────────────────────────── */

test("initials take the first letter of the first two names", () => {
  assert.equal(initialsOf("Mona Khaled", "m@x.com"), "MK");
});

test("initials ignore extra names and collapsed whitespace", () => {
  assert.equal(initialsOf("  yara   samir  adel ", "y@x.com"), "YS");
});

test("initials fall back to the email when there is no name", () => {
  assert.equal(initialsOf("", "zed@x.com"), "Z");
});

test("initials never throw on an empty name and empty email", () => {
  assert.equal(initialsOf("", ""), "?");
});

/* ── role resolution ──────────────────────────────────────────── */

test("owner_admin and manager both resolve to the app admin role", () => {
  assert.equal(toSessionUser(row({ role: "owner_admin" })).role, "admin");
  assert.equal(toSessionUser(row({ role: "manager" })).role, "admin");
});

test("auditor and moderator map through unchanged", () => {
  assert.equal(toSessionUser(row({ role: "auditor" })).role, "auditor");
  assert.equal(toSessionUser(row({ role: "moderator" })).role, "moderator");
});

test("an unknown or null role degrades to least privilege, not admin", () => {
  assert.equal(toSessionUser(row({ role: "superuser" })).role, "viewer");
  assert.equal(toSessionUser(row({ role: null })).role, "viewer");
  assert.equal(toSessionUser(row({ role: "doctor" })).role, "viewer");
});

/* ── row mapping ──────────────────────────────────────────────── */

test("a null is_active is treated as inactive, never as active", () => {
  assert.equal(toSessionUser(row({ is_active: null })).isActive, false);
});

test("a profile with no name falls back to the email as display name", () => {
  const u = toSessionUser(row({ full_name: null, email: "nour@x.com" }));
  assert.equal(u.name, "nour@x.com");
});

test("a profile with neither name nor email still renders something", () => {
  const u = toSessionUser(row({ full_name: null, email: null }));
  assert.equal(u.name, "Unknown user");
  assert.equal(u.email, "");
});

test("impersonating defaults to false and is opt-in", () => {
  assert.equal(toSessionUser(row()).impersonating, false);
  assert.equal(toSessionUser(row(), true).impersonating, true);
});

/* ── impersonation gate ───────────────────────────────────────── */

test("only an admin may impersonate, and only when the feature is enabled", () => {
  assert.equal(canImpersonate("admin", true), true);
  assert.equal(canImpersonate("admin", false), false);
});

test("a non-admin can never impersonate, even with the feature enabled", () => {
  for (const role of ["auditor", "moderator", "viewer"] as const) {
    assert.equal(canImpersonate(role, true), false, `${role} must not impersonate`);
  }
});
