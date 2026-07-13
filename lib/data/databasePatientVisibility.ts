/** PostgREST filter that retains every lead except canonical Database patients. */
export const NON_DATABASE_PATIENT_FILTER =
  "metadata->>record_source.is.null,metadata->>record_source.neq.database";

/** The mapped UI label is derived from the same canonical metadata field. */
export function isDatabasePatientSource(sourceLabel: string | undefined): boolean {
  return sourceLabel?.trim().toLocaleLowerCase() === "database";
}
