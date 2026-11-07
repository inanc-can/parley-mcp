import {
  messagesRepo,
  threadsRepo,
  type Db,
  type MessageRow,
  type ThreadRow,
} from "../../store/index.js";

export interface LogDeps {
  db: Db;
  repoRoot: string;
  write: (line: string) => void;
  threadId?: string | undefined;
}

/**
 * `parley-mcp log [--thread <id>]`: print one conversation, or list this
 * repo's threads when no thread id is given (PLAN section 7).
 */
export function runLog(deps: LogDeps): void {
  if (deps.threadId === undefined) {
    listThreads(deps);
    return;
  }
  printThread(deps, deps.threadId);
}

function listThreads(deps: LogDeps): void {
  const threads = threadsRepo.listThreadsByRepo(deps.db, deps.repoRoot);
  if (threads.length === 0) {
    deps.write("No threads in this repo yet.");
    return;
  }
  deps.write(`Threads in ${deps.repoRoot}:`);
  for (const thread of threads) {
    deps.write(`  ${thread.id}  [${thread.status}]  ${titleOf(thread)}`);
  }
}

function printThread(deps: LogDeps, threadId: string): void {
  const thread = threadsRepo.findThread(deps.db, threadId);
  if (thread?.repo_root !== deps.repoRoot) {
    deps.write(`No thread ${threadId} in this repo.`);
    return;
  }
  deps.write(`Thread ${thread.id} [${thread.status}] ${titleOf(thread)}`);
  const messages = messagesRepo.listThreadMessages(deps.db, threadId);
  for (const message of messages) {
    deps.write(formatMessage(message));
  }
}

function formatMessage(message: MessageRow): string {
  return `  ${message.from_agent} -> ${message.to_agent} [${message.kind}/${message.status}]: ${message.body}`;
}

function titleOf(thread: ThreadRow): string {
  return thread.title ?? "(untitled)";
}
