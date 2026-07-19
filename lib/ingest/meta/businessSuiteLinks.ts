import type { Platform } from "./types";

const BUSINESS_SUITE_ORIGIN = "https://business.facebook.com";

/**
 * Public Meta identifiers for the clinic's Business Suite inbox. They are not
 * credentials. Environment overrides keep the URL builder portable if the
 * connected Meta business or inbox asset changes later.
 */
export const DEFAULT_META_INBOX_CONFIG = {
  businessId: "259356358213562",
  assetId: "108936313808091",
  mailboxId: "108936313808091",
} as const;

export interface MetaInboxConfig {
  businessId: string;
  assetId: string;
  mailboxId: string;
}

export interface MetaInboxLinkInput {
  platform: Platform;
  kind: "message" | "comment";
  selectedItemId?: string | null;
  pageId?: string | null;
  recipientPageId?: string | null;
  adId?: string | null;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function selectedItem(value: string | null | undefined): string | null {
  const cleaned = clean(value);
  if (!cleaned || cleaned.includes(":")) return null;

  // Facebook post ids can arrive as `<page-id>_<post-id>`, while Business
  // Suite expects only the post portion as selected_item_id.
  const composite = cleaned.match(/^\d+_(\d+)$/);
  return composite?.[1] ?? cleaned;
}

export function metaInboxConfig(input: MetaInboxLinkInput): MetaInboxConfig {
  const payloadAsset = clean(input.pageId) ?? clean(input.recipientPageId);
  const assetId = clean(process.env.META_BUSINESS_SUITE_ASSET_ID)
    ?? payloadAsset
    ?? DEFAULT_META_INBOX_CONFIG.assetId;

  return {
    businessId: clean(process.env.META_BUSINESS_SUITE_BUSINESS_ID)
      ?? DEFAULT_META_INBOX_CONFIG.businessId,
    assetId,
    mailboxId: clean(process.env.META_BUSINESS_SUITE_MAILBOX_ID) ?? assetId,
  };
}

export function buildMetaBusinessSuiteLink(
  input: MetaInboxLinkInput,
  override?: Partial<MetaInboxConfig>,
): string {
  const config = { ...metaInboxConfig(input), ...override };
  const isInstagram = input.platform === "instagram";
  const path = input.kind === "comment"
    ? (isInstagram ? "/latest/inbox/instagram" : "/latest/inbox/facebook")
    : (isInstagram ? "/latest/inbox/instagram_direct" : "/latest/inbox/all");
  const url = new URL(path, BUSINESS_SUITE_ORIGIN);

  url.searchParams.set("asset_id", config.assetId);
  url.searchParams.set("business_id", config.businessId);
  url.searchParams.set("ir_qe_exposed", "1");

  const itemId = selectedItem(input.selectedItemId);
  if (itemId) {
    url.searchParams.set("mailbox_id", config.mailboxId);
    url.searchParams.set("selected_item_id", itemId);
    url.searchParams.set(
      "thread_type",
      input.kind === "message"
        ? (isInstagram ? "IG_MESSAGE" : "FB_MESSAGE")
        : (isInstagram ? "INSTAGRAM_POST" : (clean(input.adId) ? "FB_AD_POST" : "FB_PAGE_POST")),
    );
  }

  return url.toString();
}
