import assert from "node:assert/strict";
import test from "node:test";

import { buildMetaBusinessSuiteLink } from "./businessSuiteLinks";

const config = {
  assetId: "108936313808091",
  mailboxId: "108936313808091",
  businessId: "259356358213562",
};

function parsed(input: Parameters<typeof buildMetaBusinessSuiteLink>[0]) {
  return new URL(buildMetaBusinessSuiteLink(input, config));
}

test("builds a direct Instagram conversation link", () => {
  const url = parsed({ platform: "instagram", kind: "message", selectedItemId: "340282366841710301244260000459152184885" });
  assert.equal(url.pathname, "/latest/inbox/instagram_direct");
  assert.equal(url.searchParams.get("selected_item_id"), "340282366841710301244260000459152184885");
  assert.equal(url.searchParams.get("thread_type"), "IG_MESSAGE");
});

test("builds a Facebook Messenger conversation link", () => {
  const url = parsed({ platform: "facebook", kind: "message", selectedItemId: "100005197957723" });
  assert.equal(url.pathname, "/latest/inbox/all");
  assert.equal(url.searchParams.get("thread_type"), "FB_MESSAGE");
});

test("builds Facebook page and ad comment links from post ids", () => {
  const page = parsed({ platform: "facebook", kind: "comment", selectedItemId: "108936313808091_1784125979622441" });
  const ad = parsed({ platform: "facebook", kind: "comment", selectedItemId: "1698976024804104", adId: "ad-1" });
  assert.equal(page.pathname, "/latest/inbox/facebook");
  assert.equal(page.searchParams.get("selected_item_id"), "1784125979622441");
  assert.equal(page.searchParams.get("thread_type"), "FB_PAGE_POST");
  assert.equal(ad.searchParams.get("thread_type"), "FB_AD_POST");
});

test("builds an Instagram comment link", () => {
  const url = parsed({ platform: "instagram", kind: "comment", selectedItemId: "1828272361874469" });
  assert.equal(url.pathname, "/latest/inbox/instagram");
  assert.equal(url.searchParams.get("thread_type"), "INSTAGRAM_POST");
});

test("falls back to the general inbox when no safe selected item exists", () => {
  const url = parsed({ platform: "facebook", kind: "message", selectedItemId: "facebook_name:Unknown" });
  assert.equal(url.pathname, "/latest/inbox/all");
  assert.equal(url.searchParams.get("selected_item_id"), null);
  assert.equal(url.searchParams.get("thread_type"), null);
});
