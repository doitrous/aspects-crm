/** PostgREST filter that retains every lead except canonical Database patients. */
export const NON_DATABASE_PATIENT_FILTER =
  "metadata->>record_source.is.null,metadata->>record_source.neq.database";

/** PostgREST filter for operational queues. Database-only records remain in
 *  Database/search, but are absent from every pipeline/status surface. */
export const NON_DATABASE_ONLY_FILTER =
  "metadata->>database_only.is.null,metadata->>database_only.neq.true";

/** The mapped UI label is derived from the same canonical metadata field. */
export function isDatabasePatientSource(sourceLabel: string | undefined): boolean {
  return sourceLabel?.trim().toLocaleLowerCase() === "database";
}

export function isDatabaseOnly(databaseOnly: boolean | undefined): boolean {
  return databaseOnly === true;
}
