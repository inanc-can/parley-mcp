import {
  agreementsRepo,
  messagesRepo,
  threadsRepo,
  type AgreementRow,
  type Db,
  type MessageRow,
  type ThreadRow,
} from "../../store/index.js";

export type ExportFormat = "md" | "jsonl";

export interface ExportDeps {
  db: Db;
  repoRoot: string;
  write: (line: string) => void;
  format: ExportFormat;
}

/**
 * `parley-mcp export --format md|jsonl`: export this repo's conversations and
 * accepted decisions (PLAN section 7 / "Export: Markdown and JSONL").
 */
export function runExport(deps: ExportDeps): void {
  const threads = threadsRepo.listThreadsByRepo(deps.db, deps.repoRoot);
  const decisions = acceptedDecisions(deps.db, deps.repoRoot);
  if (deps.format === "jsonl") {
    exportJsonl(deps, threads, decisions);
    return;
  }
  exportMarkdown(deps, threads, decisions);
}

function acceptedDecisions(db: Db, repoRoot: string): AgreementRow[] {
  return agreementsRepo
    .listAgreementsByRepo(db, repoRoot)
    .filter((agreement) => agreement.status === "accepted");
}

function exportJsonl(
  deps: ExportDeps,
  threads: readonly ThreadRow[],
  decisions: readonly AgreementRow[],
): void {
  for (const thread of threads) {
    deps.write(JSON.stringify({ type: "thread", ...thread }));
    for (const message of messagesRepo.listThreadMessages(deps.db, thread.id)) {
      deps.write(JSON.stringify({ type: "message", ...message }));
    }
  }
  for (const decision of decisions) {
    deps.write(JSON.stringify({ type: "decision", ...decision }));
  }
}

function exportMarkdown(
  deps: ExportDeps,
  threads: readonly ThreadRow[],
  decisions: readonly AgreementRow[],
): void {
  deps.write(`# Parley conversations — ${deps.repoRoot}`);
  deps.write("");
  for (const thread of threads) {
    deps.write(`## ${thread.title ?? "(untitled)"} (${thread.id})`);
    deps.write(`status: ${thread.status}`);
    deps.write("");
    for (const message of messagesRepo.listThreadMessages(deps.db, thread.id)) {
      deps.write(formatMessageLine(message));
    }
    deps.write("");
  }
  deps.write("## Decisions");
  if (decisions.length === 0) {
    deps.write("(none)");
  }
  for (const decision of decisions) {
    deps.write(
      `- ${decision.text} — offered by ${decision.offered_by}, accepted by ${decision.answered_by ?? "?"}`,
    );
  }
}

function formatMessageLine(message: MessageRow): string {
  return `- **${message.from_agent} → ${message.to_agent}** [${message.kind}/${message.status}]: ${message.body}`;
}
