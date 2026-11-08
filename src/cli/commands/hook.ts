import { randomUUID } from "node:crypto";
import { detectOverlap, EDIT_OVERLAP_WINDOW_MS } from "../../core/overlap.js";
import { MESSAGE_TTL_MS } from "../../core/message-rules.js";
import { DEFAULT_MESSAGE_CAP } from "../../core/threads.js";
import { estimateTokens } from "../../core/cost.js";
import { conflictNotice, type Notifier } from "../../notify/os-notify.js";
import { normalizeClaimGlob, repoRelativePath } from "../../core/edit-paths.js";
import {
  agentsRepo,
  claimsRepo,
  editsRepo,
  messageEventsRepo,
  messagesRepo,
  threadsRepo,
  type Db,
} from "../../store/index.js";

export interface HookEditDeps {
  db: Db;
  repoRoot: string;
  /** Diagnostic lines (stderr for Claude hooks; see HookEventDeps.status). */
  status: (line: string) => void;
  now?: number;
  /** Tell the human about a conflict (PLAN 4.5 / section 9). */
  notify?: Notifier;
  /** The agent's working folder, for resolving a relative edited path (default: the repo root). */
  cwd?: string;
  /** Wake a warned agent that needs an out-of-band wake (Codex), so it sees the warning now. */
  wakeRecipient?: (agentId: string, harness: string) => boolean;
}

/** The system sender for hub-written messages (same id the viewer's veto notices use). */
const SYSTEM_ID = "system";

/**
 * Two agents working on one file trigger a conflict on every edit. A warning
 * already given to the same agents in the file's thread within this window is
 * not repeated (messages or notification).
 */
export const CONFLICT_REPEAT_MS = 10 * 60 * 1000;

/**
 * `mcp-parley hook edit --agent <id> --path <path>`: used by post-edit hooks.
 * Records the edit, then warns (never blocks, PLAN 4.5) about overlap with
 * other agents' active claims and their edits of the same file in the last
 * 30 minutes. Returns the number of conflicts found.
 */
export function runHookEdit(deps: HookEditDeps, agentId: string, rawPath: string): number {
  const now = deps.now ?? Date.now();
  // Stored and compared repo-relative, so every harness's form of a path meets.
  const path = repoRelativePath(deps.repoRoot, deps.cwd ?? deps.repoRoot, rawPath);
  if (path === null) {
    deps.status(`edit ignored: ${rawPath} is outside ${deps.repoRoot}`);
    return 0;
  }
  const editId = randomUUID();
  editsRepo.insertEdit(deps.db, {
    id: editId,
    repoRoot: deps.repoRoot,
    agentId,
    path,
    at: now,
  });
  const claims = claimsRepo
    .listActiveClaims(deps.db, deps.repoRoot, now)
    .map((claim) => ({ ...claim, path_glob: normalizeClaimGlob(deps.repoRoot, claim.path_glob) }));
  const recentEdits = editsRepo.listRecentEditsForPath(
    deps.db,
    deps.repoRoot,
    path,
    now - EDIT_OVERLAP_WINDOW_MS,
  );
  const conflicts = detectOverlap({
    path,
    agentId,
    now,
    claims,
    recentEdits,
  });
  if (conflicts.length === 0) {
    deps.status(`edit recorded: ${agentId} ${path} (no overlap)`);
    return 0;
  }
  deps.status(`edit recorded: ${agentId} ${path} — overlap warning:`);
  for (const conflict of conflicts) {
    deps.status(`  ${conflict.agentId} (${conflict.kind}): ${conflict.detail}`);
  }
  const others = [...new Set(conflicts.map((c) => c.agentId))].sort();
  const told = tellAgents(deps, now, editId, path, agentId, others, conflicts.map((c) => `${c.agentId}: ${c.detail}`));
  if (told) {
    deps.notify?.(conflictNotice(path, agentId, others));
  } else {
    deps.status(`  (already warned about ${path} in the last 10 minutes; not repeated)`);
  }
  return conflicts.length;
}

/**
 * PLAN 4.5: on a conflict, both sides get a system message in a thread named
 * after the file (reused while it is open), so each sees it in its inbox.
 * Returns false (nothing sent) when every one of them was already warned there
 * within CONFLICT_REPEAT_MS.
 */
function tellAgents(
  deps: HookEditDeps,
  now: number,
  editId: string,
  path: string,
  editor: string,
  others: readonly string[],
  details: readonly string[],
): boolean {
  const title = `conflict: ${path}`;
  const existing = threadsRepo
    .listThreadsByRepo(deps.db, deps.repoRoot)
    .find((t) => t.title === title && t.status !== "closed");
  const thread =
    existing ??
    threadsRepo.createThread(deps.db, {
      id: randomUUID(),
      repoRoot: deps.repoRoot,
      title,
      status: "open",
      messageCap: DEFAULT_MESSAGE_CAP,
      createdAt: now,
    });
  const recipients = [editor, ...others];
  const recent = messagesRepo
    .listThreadMessages(deps.db, thread.id)
    .filter((m) => m.from_agent === SYSTEM_ID && now - m.sent_at < CONFLICT_REPEAT_MS)
    .map((m) => m.to_agent);
  if (existing !== undefined && recipients.every((to) => recent.includes(to))) {
    return false;
  }
  const body =
    `Overlap on ${path}: ${editor} just edited it while ${others.join(", ")} also claimed or edited it ` +
    `(${details.join("; ")}). Nothing was blocked; agree who owns it with the agree tool.`;
  for (const to of recipients) {
    const inserted = messagesRepo.insertMessageIdempotent(deps.db, {
      id: randomUUID(),
      threadId: thread.id,
      fromAgent: SYSTEM_ID,
      toAgent: to,
      kind: "text",
      body,
      payloadJson: null,
      replyTo: null,
      status: "sent",
      sentAt: now,
      expiresAt: now + MESSAGE_TTL_MS,
      idempotencyKey: `conflict-${editId}::${to}`,
      estTokens: estimateTokens(body),
    });
    if (inserted.created) {
      messageEventsRepo.insertMessageEvent(deps.db, {
        id: randomUUID(),
        messageId: inserted.message.id,
        event: "sent",
        at: now,
        detailJson: null,
      });
      const agent = agentsRepo.findAgent(deps.db, to);
      if (agent !== undefined) {
        deps.wakeRecipient?.(agent.id, agent.harness);
      }
    }
  }
  return true;
}
