export interface ParsedLeadPhone {
  countryCode: string | null;
  phoneNumber: string;
  normalizedPhone: string;
}

/** Blank is a valid lead profile value; booking still validates phone itself. */
export function parseOptionalLeadPhone(raw: string): ParsedLeadPhone | null {
  const phone = raw.trim();
  if (!phone) return null;

  const countryCodeMatch = phone.match(/^\s*(\+\d{1,4})[\s-]+(.+)$/);
  return {
    countryCode: countryCodeMatch?.[1] ?? null,
    phoneNumber: (countryCodeMatch?.[2] ?? phone).replace(/\s+/g, " "),
    normalizedPhone: phone.replace(/\D/g, ""),
  };
}
