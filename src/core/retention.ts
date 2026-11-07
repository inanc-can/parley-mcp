export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export function retentionCutoff(now: number): number {
  return now - RETENTION_MS;
}
