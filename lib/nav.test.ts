import { strict as assert } from "node:assert";
import { test } from "node:test";
import { activeHref, visibleNav, type NavItem } from "./nav";

const ITEMS: NavItem[] = [
  { label: "Dashboard", i18nKey: "nav.dashboard", href: "/dashboard", icon: "" },
  { label: "Leads", i18nKey: "nav.newLeads", href: "/leads", icon: "" },
  { label: "Users & Roles", i18nKey: "nav.users", href: "/settings/users", icon: "" },
  { label: "Settings", i18nKey: "nav.settings", href: "/settings", icon: "" },
];

test("an exact path activates its own item", () => {
  assert.equal(activeHref("/dashboard", ITEMS), "/dashboard");
});

test("a nested path activates the most specific item, not its ancestor", () => {
  assert.equal(activeHref("/settings/users", ITEMS), "/settings/users");
  assert.equal(activeHref("/settings/users/abc-123", ITEMS), "/settings/users");
});

test("the ancestor still activates for its own path", () => {
  assert.equal(activeHref("/settings", ITEMS), "/settings");
});

test("a child route activates its parent when no more specific item exists", () => {
  assert.equal(activeHref("/leads/lead-42", ITEMS), "/leads");
});

test("a sibling with a shared prefix does not match", () => {
  assert.equal(activeHref("/settingsx", ITEMS), null);
  assert.equal(activeHref("/leadsomething", ITEMS), null);
});

test("an unknown path activates nothing", () => {
  assert.equal(activeHref("/nowhere", ITEMS), null);
});

test("exactly one item is ever active for any nav path", () => {
  for (const item of ITEMS) {
    const winner = activeHref(item.href, ITEMS);
    const claimants = ITEMS.filter((i) => i.href === winner);
    assert.equal(claimants.length, 1, `${item.href} produced ${claimants.length} active items`);
  }
});

/* ── role gating ──────────────────────────────────────────────── */

test("a moderator never sees the auditor, reports, users or settings nav", () => {
  const hrefs = visibleNav("moderator").map((n) => n.href);
  for (const gated of ["/auditor", "/reports", "/settings", "/settings/users"]) {
    assert.equal(hrefs.includes(gated), false, `moderator must not see ${gated}`);
  }
});

test("an auditor sees Users & Roles, Settings and Emails (owns operational config, §C)", () => {
  const hrefs = visibleNav("auditor").map((n) => n.href);
  assert.equal(hrefs.includes("/settings/users"), true);
  assert.equal(hrefs.includes("/settings"), true);
  assert.equal(hrefs.includes("/emails"), true);
});

test("a moderator never sees the emails nav", () => {
  const hrefs = visibleNav("moderator").map((n) => n.href);
  assert.equal(hrefs.includes("/emails"), false);
});

test("an admin sees every nav item", () => {
  assert.equal(visibleNav("admin").length >= visibleNav("auditor").length, true);
  assert.equal(visibleNav("admin").map((n) => n.href).includes("/settings"), true);
});
