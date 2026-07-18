import type { DuplicatePair, DuplicateQueueFilters, DuplicateSearchField } from "@/lib/types";

const SEARCH_FIELDS = new Set<DuplicateSearchField>(["all", "name", "phone", "mrn", "lead_id", "platform_id"]);

export function normalizeDuplicateFilters(filters?: DuplicateQueueFilters): Required<DuplicateQueueFilters> {
  const q = filters?.q?.replace(/[%,()]/g, " ").trim().slice(0, 120) ?? "";
  const field = SEARCH_FIELDS.has(filters?.field as DuplicateSearchField) ? filters!.field! : "all";
  const matchType = filters?.matchType?.replace(/[^a-z0-9_]/gi, "").slice(0, 40) ?? "";
  return { q, field, matchType };
}

export function duplicateQueueRpcUnavailable(error: { code?: string; message?: string } | null): boolean {
  return error?.code === "PGRST202" || Boolean(error?.message?.includes("Could not find") && error.message.includes("crm_duplicate_queue_page"));
}

function searchableValues(pair: DuplicatePair, field: DuplicateSearchField): string[] {
  const leads = [pair.primary, pair.duplicate].filter(Boolean);
  if (field === "name") return leads.map((lead) => lead!.name);
  if (field === "phone") return leads.map((lead) => lead!.phone);
  if (field === "mrn") return leads.map((lead) => lead!.mrn ?? "");
  if (field === "lead_id") return leads.map((lead) => lead!.id);
  if (field === "platform_id") return leads.map((lead) => lead!.platformId ?? "");
  return leads.flatMap((lead) => [lead!.name, lead!.phone, lead!.mrn ?? "", lead!.id, lead!.platformId ?? ""])
    .concat(pair.notes ?? "", pair.type);
}

/** Mirrors the database filter for mock mode and unit tests. */
export function duplicateMatchesFilters(pair: DuplicatePair, filters?: DuplicateQueueFilters): boolean {
  const normalized = normalizeDuplicateFilters(filters);
  if (normalized.matchType && pair.type !== normalized.matchType) return false;
  if (!normalized.q) return true;
  const term = normalized.q.toLocaleLowerCase();
  const digits = normalized.q.replace(/\D/g, "");
  return searchableValues(pair, normalized.field).some((value) => {
    const candidate = value.toLocaleLowerCase();
    return candidate.includes(term) || Boolean(digits && candidate.replace(/\D/g, "").includes(digits));
  });
}
