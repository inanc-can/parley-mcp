import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const RULES_PATH = join(".parley", "rules.md");

export interface RulesFile {
  exists: boolean;
  text: string | null;
}

/**
 * The optional rules file `.parley/rules.md` is created only by the human
 * (PLAN section 2). `talk` and `inbox` mention that rules exist;
 * `inbox` also returns the rules text once per session.
 */
export function readRulesFile(repoRoot: string): RulesFile {
  const path = join(repoRoot, RULES_PATH);
  let exists: boolean;
  try {
    exists = statSync(path).isFile();
  } catch {
    return { exists: false, text: null };
  }
  if (!exists) {
    return { exists: false, text: null };
  }
  return { exists: true, text: readFileSync(path, "utf8") };
}

export function rulesReminder(rules: RulesFile): string | null {
  if (!rules.exists) {
    return null;
  }
  return "This repo has a .parley/rules.md rules file for agents; see your inbox for its text.";
}
