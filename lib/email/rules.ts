/**
 * Pure helpers for the email-rule engine (§E). No I/O so they can be unit
 * tested; the DB-bound orchestration lives in `lib/email/send.ts`.
 */

export type RecipientType = "static" | "role" | "involved_lead" | "moderators" | "auditors";

export interface RecipientSpec {
  type: RecipientType;
  value?: string;
}

/** Normalize the jsonb `recipients` array into typed specs, dropping junk. */
export function parseRecipients(raw: unknown): RecipientSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: RecipientSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = (item as { type?: unknown }).type;
    if (
      type === "static" ||
      type === "role" ||
      type === "involved_lead" ||
      type === "moderators" ||
      type === "auditors"
    ) {
      const value = (item as { value?: unknown }).value;
      out.push({ type, value: typeof value === "string" ? value : undefined });
    }
  }
  return out;
}

/** `{{key}}` substitution. Unknown keys render as an empty string. */
export function renderTemplate(template: string, ctx: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = ctx[key];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Idempotency key for a send. Two sends that share (ruleKey, discriminator) and
 * fall in the same time bucket produce the same key, so a unique index on
 * `crm_email_log.dedupe_key` blocks the duplicate. `windowHours <= 0` means "no
 * time bucketing" — the (ruleKey, discriminator) pair is deduped forever.
 */
export function buildDedupeKey(
  ruleKey: string,
  discriminator: string,
  windowHours: number | null | undefined,
  nowMs: number,
): string {
  if (!windowHours || windowHours <= 0) return `${ruleKey}:${discriminator}`;
  const bucket = Math.floor(nowMs / (windowHours * 3_600_000));
  return `${ruleKey}:${discriminator}:${bucket}`;
}

/** True when a valid-looking email address. Deliberately permissive. */
export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

/** De-duplicate + validate a resolved recipient list. */
export function normalizeEmails(emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const e of emails) {
    if (!e) continue;
    const trimmed = e.trim().toLowerCase();
    if (isEmail(trimmed)) seen.add(trimmed);
  }
  return [...seen];
}
