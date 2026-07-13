export type RevisitingMatch = "mrn" | "phone";

export function normalizePatientMrn(value: string | undefined | null): string | null {
  const mrn = value?.trim() ?? "";
  return /^\d{1,9}$/.test(mrn) ? mrn : null;
}

export function isRevisitingMetadata(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.revisiting_patient === true;
}

export function withRevisitingMetadata(
  metadata: Record<string, unknown> | null | undefined,
  match: RevisitingMatch,
  appointmentId: string,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    revisiting_patient: true,
    revisiting_match: match,
    revisiting_appointment_id: appointmentId,
    revisiting_detected_at: new Date().toISOString(),
  };
}
