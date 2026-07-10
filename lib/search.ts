/**
 * Global lead search: which leads to ask the database for, and how to order
 * what comes back.
 *
 * The data layer's `getLeads({ q })` filter is a broad `ILIKE` across seven
 * columns ordered by `updated_at`. That is the right net to cast but the wrong
 * order to show: someone who types a full lead id wants that lead first, not
 * whichever lead was touched most recently. So the ranking lives here, as a
 * pure function, and the page sorts the rows the provider hands it.
 *
 * Pure module: no I/O. Safe to unit-test and safe to run in the browser.
 */

import type { Lead } from "@/lib/types";

/** The field a hit matched on, so a phone result that looks nothing like the
 *  typed text can still explain why it is on screen. */
export type MatchField = "id" | "mrn" | "phone" | "name" | "service" | "platformId";

export interface SearchHit {
  lead: Lead;
  field: MatchField;
  /** Higher is a better match. Only meaningful relative to other hits. */
  score: number;
}

/** Human labels for the "matched on …" caption under each result. */
export const MATCH_LABEL: Record<MatchField, string> = {
  id: "Lead ID",
  mrn: "MRN",
  phone: "Phone",
  name: "Name",
  service: "Service",
  platformId: "Platform ID",
};

function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Does any word in `haystack` start with `needle`? Lets "hassan" find "Ahmed Hassan". */
function wordPrefix(haystack: string, needle: string): boolean {
  return haystack.split(/\s+/).some((w) => w.startsWith(needle));
}

/**
 * The term(s) to hand the data layer for one raw query.
 *
 * A phone typed as `0100 123 4567` never matches a stored `01001234567`, so a
 * digits-only variant is searched alongside the literal text. Two terms mean
 * two queries whose results are merged and deduped by {@link rankLeads}.
 */
export function searchTerms(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const terms = [text];
  const bare = digits(text);
  // Three digits is the shortest thing worth treating as a phone fragment;
  // below that the digits-only query is noise that matches half the table.
  if (bare.length >= 3 && bare !== text) terms.push(bare);
  return [...new Set(terms)];
}

/**
 * Score one lead against the raw query, or `null` if it does not match.
 *
 * Ordered most-certain first. An exact lead id is unambiguous; a service-name
 * substring is a guess. The provider's `ILIKE` net is wider than this (it also
 * matches chat links), so a row that scores `null` is dropped rather than shown
 * with no visible reason for being there.
 */
export function scoreLead(lead: Lead, raw: string): { field: MatchField; score: number } | null {
  const q = normalize(raw);
  if (!q) return null;
  const qd = digits(q);

  const id = lead.id.toLowerCase();
  if (id === q) return { field: "id", score: 100 };

  const mrn = lead.mrn ? normalize(lead.mrn) : "";
  if (mrn && mrn === q) return { field: "mrn", score: 95 };

  const phone = digits(lead.phone ?? "");
  if (qd.length >= 3 && phone) {
    if (phone === qd) return { field: "phone", score: 90 };
    // A national number typed without its country code still identifies the patient.
    if (phone.endsWith(qd)) return { field: "phone", score: 82 };
    if (phone.includes(qd)) return { field: "phone", score: 64 };
  }

  const name = normalize(lead.patientName ?? "");
  if (name && name === q) return { field: "name", score: 86 };
  if (name && name.startsWith(q)) return { field: "name", score: 70 };
  if (name && wordPrefix(name, q)) return { field: "name", score: 60 };
  if (name && name.includes(q)) return { field: "name", score: 50 };

  if (id.includes(q)) return { field: "id", score: 45 };
  if (mrn && mrn.includes(q)) return { field: "mrn", score: 40 };

  const service = normalize(lead.serviceName ?? "");
  if (service && service.includes(q)) return { field: "service", score: 30 };

  const platformId = normalize(lead.platformId ?? "");
  if (platformId && platformId.includes(q)) return { field: "platformId", score: 20 };

  return null;
}

/** Most recent activity on a lead, used only to break scoring ties. */
function recency(lead: Lead): number {
  const at = lead.lastMessageAt ?? lead.createdAt;
  const t = new Date(at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Rank and dedupe. `leads` may contain the same lead twice because
 * {@link searchTerms} issued two queries; the first copy wins.
 *
 * Ties break on recency, then on lead id, so the same query always produces the
 * same order — a result list that reshuffles between reloads is unusable.
 */
export function rankLeads(leads: Lead[], raw: string): SearchHit[] {
  const seen = new Set<string>();
  const hits: SearchHit[] = [];

  for (const lead of leads) {
    if (seen.has(lead.id)) continue;
    seen.add(lead.id);
    const match = scoreLead(lead, raw);
    if (match) hits.push({ lead, field: match.field, score: match.score });
  }

  hits.sort(
    (a, b) =>
      b.score - a.score ||
      recency(b.lead) - recency(a.lead) ||
      a.lead.id.localeCompare(b.lead.id),
  );
  return hits;
}
