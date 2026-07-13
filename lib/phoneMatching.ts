/** Phone values with four or fewer digits are placeholders, not identities. */
export const MIN_PHONE_MATCH_DIGITS = 5;

export function phoneDigits(value: string | undefined | null): string {
  return (value ?? "").replace(/\D/g, "");
}

export function matchablePhoneDigits(value: string | undefined | null): string | null {
  const digits = phoneDigits(value);
  return digits.length >= MIN_PHONE_MATCH_DIGITS ? digits : null;
}

/** Shared in-file duplicate key. Long international numbers use the CRM's
 * established final-nine-digit comparison; short-but-valid values stay exact. */
export function phoneDuplicateKey(value: string | undefined | null): string | null {
  const digits = matchablePhoneDigits(value);
  if (!digits) return null;
  return digits.length >= 7 ? digits.slice(-9) : digits;
}
