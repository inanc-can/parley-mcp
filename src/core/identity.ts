export interface AgentIdentity {
  id: string;
  harness: string;
  folder: string;
  suffix: number | null;
}

export const ALIVE_WINDOW_MS = 30 * 1000;

/**
 * Presence: an agent is alive when it sent a heartbeat within the last 30 s
 * (PLAN section 2). An agent without any heartbeat has never been seen here.
 */
export function isAlive(lastHeartbeat: number | null, now: number): boolean {
  return lastHeartbeat !== null && now - lastHeartbeat <= ALIVE_WINDOW_MS;
}

export function formatAgentId(harness: string, folder: string, suffix: number | null): string {
  const base = `${harness}@${folder}`;
  if (suffix === null || suffix < 2) {
    return base;
  }
  return `${base}-${String(suffix)}`;
}

export function parseAgentId(id: string): AgentIdentity | null {
  const at = id.indexOf("@");
  if (at <= 0) {
    return null;
  }
  const harness = id.slice(0, at);
  const rest = id.slice(at + 1);
  if (rest.length === 0) {
    return null;
  }
  const match = /^(.+)-(\d+)$/.exec(rest);
  if (match) {
    const folder = match[1];
    const suffixText = match[2];
    if (folder !== undefined && suffixText !== undefined) {
      const suffix = Number(suffixText);
      if (Number.isInteger(suffix) && suffix >= 2) {
        return { id, harness, folder, suffix };
      }
    }
  }
  return { id, harness, folder: rest, suffix: null };
}

export function nextClashId(harness: string, folder: string, existingIds: readonly string[]): string {
  const base = formatAgentId(harness, folder, null);
  if (!existingIds.includes(base)) {
    return base;
  }
  let n = 2;
  while (existingIds.includes(formatAgentId(harness, folder, n))) {
    n += 1;
  }
  return formatAgentId(harness, folder, n);
}
