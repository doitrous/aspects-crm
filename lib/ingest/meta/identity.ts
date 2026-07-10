/**
 * Identity resolution and merge safety.
 *
 * The normalizers may hand us a real platform-scoped id, or a synthetic
 * fallback id when Meta withheld one. The prefix of a fallback id tells us how
 * much it is worth:
 *
 *   instagram_username:<handle>        → medium  (handles are unique per platform)
 *   facebook_name:<display name>       → weak    (names are NOT unique)
 *   unknown_facebook_commenter:<n>     → none
 *   unknown_instagram_commenter:<n>    → none
 *
 * The single rule that protects the lead database: **only `strong` and `medium`
 * identities may match or create a lead.** A `weak` identity means we know a
 * display name and nothing else, and two different people routinely share a
 * display name — merging on that is irreversible and wrong.
 */

import type { IdentityConfidence, Identity, Platform } from "./types";

const FALLBACK_PREFIXES = [
  "facebook_name:",
  "instagram_username:",
  "unknown_facebook_commenter:",
  "unknown_instagram_commenter:",
] as const;

/** Confidence implied purely by the shape of an id. */
function confidenceFromId(id: string | null): IdentityConfidence {
  if (!id) return "none";
  if (id.startsWith("instagram_username:")) return "medium";
  if (id.startsWith("facebook_name:")) return "weak";
  if (id.startsWith("unknown_facebook_commenter:")) return "none";
  if (id.startsWith("unknown_instagram_commenter:")) return "none";
  return "strong";
}

export function isFallbackId(id: string | null): boolean {
  return !!id && FALLBACK_PREFIXES.some((p) => id.startsWith(p));
}

const VALID: IdentityConfidence[] = ["strong", "medium", "weak", "none"];

const RANK: Record<IdentityConfidence, number> = {
  none: 0,
  weak: 1,
  medium: 2,
  strong: 3,
};

/**
 * Resolve an identity, trusting the normalizer's `identity_confidence` when it
 * is present and valid — but never letting it claim MORE confidence than the id
 * shape actually supports. A payload asserting `strong` while carrying a
 * `facebook_name:` id is downgraded, not believed.
 */
export function resolveIdentity(input: {
  platform: Platform;
  platformUserId?: string | null;
  declaredConfidence?: string | null;
  name?: string | null;
  username?: string | null;
  phone?: string | null;
  psid?: string | null;
  instagramId?: string | null;
}): Identity {
  const platformUserId = input.platformUserId?.trim() || null;
  const implied = confidenceFromId(platformUserId);

  const declared =
    input.declaredConfidence && VALID.includes(input.declaredConfidence as IdentityConfidence)
      ? (input.declaredConfidence as IdentityConfidence)
      : null;

  // Take the declared value only when it does not overstate the id's strength.
  const confidence = declared && RANK[declared] <= RANK[implied] ? declared : implied;

  return {
    platformUserId,
    confidence,
    name: input.name?.trim() || null,
    username: input.username?.trim() || null,
    phone: input.phone?.trim() || null,
    psid: input.psid?.trim() || null,
    instagramId: input.instagramId?.trim() || null,
    isFallback: isFallbackId(platformUserId),
  };
}

/**
 * May this identity be used to look up or create a lead?
 *
 * Anything below `medium` is a display name with no durable handle behind it.
 * Such events are still stored (never dropped), but they are attached to an
 * existing conversation if one is already known, and otherwise recorded without
 * a lead rather than inventing one.
 */
export function canIdentifyLead(identity: Identity): boolean {
  if (!identity.platformUserId) return false;
  return identity.confidence === "strong" || identity.confidence === "medium";
}

/** May this identity drive an irreversible lead merge? Strong ids only. */
export function canMergeLead(identity: Identity): boolean {
  return identity.confidence === "strong" && !identity.isFallback;
}

/** Best human label for an actor, for UI and audit rows. */
export function displayName(identity: Identity): string | null {
  if (identity.name) return identity.name;
  if (identity.username) return `@${identity.username}`;
  if (identity.platformUserId && identity.isFallback) {
    const value = identity.platformUserId.split(":").slice(1).join(":");
    if (identity.platformUserId.startsWith("instagram_username:")) return `@${value}`;
    if (identity.platformUserId.startsWith("facebook_name:")) return value || null;
    return null;
  }
  return null;
}
