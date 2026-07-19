import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMetaBusinessSuiteLink,
  DEFAULT_META_INBOX_CONFIG,
  metaInboxConfig,
} from "./businessSuiteLinks";

const ORIGIN = "https://business.facebook.com";
const ROUTING = "asset_id=108936313808091&business_id=259356358213562&ir_qe_exposed=1&mailbox_id=108936313808091";

test("uses the exact fixed routing triple from every supplied working example", () => {
  assert.deepEqual(metaInboxConfig(), DEFAULT_META_INBOX_CONFIG);
});

test("matches the supplied Facebook Messenger URL contract exactly", () => {
  assert.equal(
    buildMetaBusinessSuiteLink({
      platform: "facebook",
      kind: "message",
      selectedItemId: "100005197957723",
    }),
    `${ORIGIN}/latest/inbox/all?${ROUTING}&selected_item_id=100005197957723&thread_type=FB_MESSAGE`,
  );
});

test("matches the supplied Instagram DM URL contract exactly", () => {
  assert.equal(
    buildMetaBusinessSuiteLink({
      platform: "instagram",
      kind: "message",
      selectedItemId: "340282366841710301244259915952811050007",
    }),
    `${ORIGIN}/latest/inbox/instagram_direct?${ROUTING}&selected_item_id=340282366841710301244259915952811050007&thread_type=IG_MESSAGE`,
  );
});

test("matches the supplied Facebook page-comment URL contract exactly", () => {
  assert.equal(
    buildMetaBusinessSuiteLink({
      platform: "facebook",
      kind: "comment",
      selectedItemId: "108936313808091_1784125979622441",
    }),
    `${ORIGIN}/latest/inbox/facebook?${ROUTING}&selected_item_id=1784125979622441&thread_type=FB_PAGE_POST`,
  );
});

test("matches the supplied Facebook ad-comment URL contract exactly", () => {
  assert.equal(
    buildMetaBusinessSuiteLink({
      platform: "facebook",
      kind: "comment",
      selectedItemId: "1698976024804104",
      adId: "synthetic-ad-id",
    }),
    `${ORIGIN}/latest/inbox/facebook?${ROUTING}&selected_item_id=1698976024804104&thread_type=FB_AD_POST`,
  );
});

test("preserves an explicit FB_AD_POST classification from normalized n8n data", () => {
  const url = new URL(buildMetaBusinessSuiteLink({
    platform: "facebook",
    kind: "comment",
    selectedItemId: "1698976024804104",
    threadType: "FB_AD_POST",
  }));
  assert.equal(url.searchParams.get("thread_type"), "FB_AD_POST");
});

test("matches the supplied Instagram-comment URL contract exactly", () => {
  assert.equal(
    buildMetaBusinessSuiteLink({
      platform: "instagram",
      kind: "comment",
      selectedItemId: "1828272361874469",
    }),
    `${ORIGIN}/latest/inbox/instagram?${ROUTING}&selected_item_id=1828272361874469&thread_type=INSTAGRAM_POST`,
  );
});

test("falls back to the channel inbox when no safe selected item exists", () => {
  const url = new URL(buildMetaBusinessSuiteLink({
    platform: "facebook",
    kind: "message",
    selectedItemId: "facebook_name:Unknown",
  }));
  assert.equal(url.pathname, "/latest/inbox/all");
  assert.equal(url.searchParams.get("asset_id"), "108936313808091");
  assert.equal(url.searchParams.get("business_id"), "259356358213562");
  assert.equal(url.searchParams.get("selected_item_id"), null);
  assert.equal(url.searchParams.get("thread_type"), null);
});
