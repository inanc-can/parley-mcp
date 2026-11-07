export interface SecretMatch {
  kind: string;
}

interface SecretPattern {
  kind: string;
  pattern: RegExp;
}

const SECRET_PATTERNS: readonly SecretPattern[] = [
  { kind: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: "github_token", pattern: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { kind: "github_pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { kind: "openai_or_anthropic_key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { kind: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    kind: "private_key_pem",
    pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  },
  {
    kind: "env_secret_line",
    pattern: /^\s*(?:[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*)\s*=\s*\S{12,}\s*$/m,
  },
];

export function scanSecret(text: string): SecretMatch | null {
  for (const entry of SECRET_PATTERNS) {
    if (entry.pattern.test(text)) {
      return { kind: entry.kind };
    }
  }
  return null;
}

export type StopAllCheck = { ok: true } | { ok: false; code: "stop_all" };

/**
 * Global stop control: when the human flipped stop_all, every `talk` call is
 * blocked until they turn it off again (PLAN 4.4). Pure decision over the
 * stored setting; the store reads the setting, callers compose the two.
 */
export function checkStopAll(stopAll: boolean): StopAllCheck {
  if (stopAll) {
    return { ok: false, code: "stop_all" };
  }
  return { ok: true };
}
