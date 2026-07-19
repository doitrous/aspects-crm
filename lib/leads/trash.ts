export const LEAD_TRASH_RETENTION_DAYS = 30;

export function trashConfirmation(leadId: string): string {
  return `MOVE ${leadId} TO TRASH`;
}

export function permanentDeleteConfirmation(leadId: string): string {
  return `DELETE ${leadId} PERMANENTLY`;
}

export function trashDaysRemaining(purgeAfter: string, now = new Date()): number {
  const remaining = new Date(purgeAfter).getTime() - now.getTime();
  if (!Number.isFinite(remaining)) return 0;
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}
