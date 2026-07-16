export function normalizeSafeExternalUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("Enter a valid http:// or https:// URL."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Only http:// and https:// conversation links are allowed.");
  return parsed.toString();
}
