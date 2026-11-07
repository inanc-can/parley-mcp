import type { Command } from "commander";
import type { WakeSpawner } from "../adapters/codex/spawn-wake.js";
import type { Notifier } from "../notify/os-notify.js";
import { registerCursorHookCommands, type CursorHookHost } from "./cursor-hook-commands.js";
import { messagesRepo, type Db } from "../store/index.js";
import { runHookEdit } from "./commands/hook.js";
import {
  runHookPostTool,
  runHookSessionEnd,
  runHookSessionStart,
  runHookStop,
  runHookUserPrompt,
  type HookEventDeps,
} from "./commands/hook-events.js";
import {
  codexAgentId,
  postToolPayloadSchema,
  sessionEndPayloadSchema,
  sessionStartPayloadSchema,
  stopPayloadSchema,
  userPromptPayloadSchema,
} from "./commands/hook-payloads.js";

/**
 * Wiring for the adapter-facing `hook` subcommands (PLAN section 6 + 7). Split
 * out of cli/index.ts to keep each file under the 400-line limit. The host
 * provides the shared plumbing (db access, the stderr status channel, stdin
 * reading) so these registrations stay declarative.
 */
export interface HookCommandHost {
  /** Run with the hub db open, closing it afterwards. */
  withDb: <T>(run: (db: Db, repoRoot: string) => T) => T;
  /** The stderr diagnostic channel (never the harness's stdout). */
  status: () => (line: string) => void;
  /** Read and JSON-parse the hook payload from stdin. */
  readStdinJson: () => Promise<unknown>;
  /** Start a detached `codex-wake` for an agent (the Codex Stop backstop). */
  wakeCodex: WakeSpawner;
  /** OS notifications for edit conflicts (PLAN section 9). */
  notify: Notifier;
  /** The Cursor hooks' extra plumbing (repo from the payload, JSON replies on stdout). */
  cursor: CursorHookHost;
}

/** How long a Stop-started wake waits for the ending turn to go idle. */
const STOP_WAKE_WAIT_S = 120;

/** The extra HookEventDeps that make the shared handlers act as Codex. */
const CODEX_HOOK_DEPS: Pick<HookEventDeps, "agentIdForCwd" | "editTools"> = {
  agentIdForCwd: codexAgentId,
  editTools: new Set(["Edit", "Write", "MultiEdit", "apply_patch"]),
};

/** Register `hook edit` plus the Claude Code and Codex lifecycle hooks. */
export function registerHookCommands(program: Command, host: HookCommandHost): void {
  const hook = program.command("hook").description("Used by adapters: record harness events.");

  hook
    .command("edit")
    .requiredOption("--agent <id>", "the editing agent")
    .requiredOption("--path <path>", "the edited path")
    .action((options: { agent: string; path: string }) => {
      const status = host.status();
      host.withDb((db, repoRoot) => {
        runHookEdit({ db, repoRoot, status, notify: host.notify }, options.agent, options.path);
      });
    });

  registerClaudeHookCommands(hook, host);
  registerCodexHookCommands(hook, host);
  registerCursorHookCommands(hook, host.cursor);
}

/**
 * The Claude Code hook events (PLAN section 6). Each reads its JSON payload from
 * stdin, Zod-parses it at the boundary, ignores subagent payloads, and runs the
 * matching handler. Diagnostic output goes to stderr: a Claude Code hook's
 * stdout becomes model context, so only real deliveries (the monitor's job)
 * belong there.
 */
function registerClaudeHookCommands(hook: Command, host: HookCommandHost): void {
  hook
    .command("session-start")
    .description("Claude Code SessionStart: register the agent.")
    .action(async () => {
      const status = host.status();
      const payload = sessionStartPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookSessionStart({ db, repoRoot, status }, payload);
      });
    });

  hook
    .command("user-prompt")
    .description("Claude Code UserPromptSubmit: read-evidence + heartbeat.")
    .action(async () => {
      const status = host.status();
      const payload = userPromptPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookUserPrompt({ db, repoRoot, status }, payload);
      });
    });

  hook
    .command("stop")
    .description("Claude Code Stop: heartbeat at turn end (delivery via the monitor).")
    .action(async () => {
      const status = host.status();
      const payload = stopPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookStop({ db, repoRoot, status }, payload);
      });
    });

  hook
    .command("post-tool")
    .description("Claude Code PostToolUse: heartbeat + record edits.")
    .action(async () => {
      const status = host.status();
      const payload = postToolPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookPostTool({ db, repoRoot, status, notify: host.notify }, payload);
      });
    });

  hook
    .command("session-end")
    .description("Claude Code SessionEnd: requeue unread delivered messages.")
    .action(async () => {
      const status = host.status();
      const payload = sessionEndPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookSessionEnd({ db, repoRoot, status }, payload);
      });
    });
}

/**
 * The Codex hook events (PLAN section 6 "Codex"). Codex's hook payloads use the
 * same stdin field names as Claude Code (session_id, cwd, prompt, tool_input,
 * source, reason — verified in docs/harness-notes.md M5), so the same Zod
 * schemas and handlers apply; the only harness-specific wiring is the agent id
 * (`codex@<folder>`) and the edit-tool set (Codex adds `apply_patch`).
 */
function registerCodexHookCommands(hook: Command, host: HookCommandHost): void {
  hook
    .command("codex-session-start")
    .description("Codex SessionStart: register the agent.")
    .action(async () => {
      const status = host.status();
      const payload = sessionStartPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookSessionStart({ db, repoRoot, status, ...CODEX_HOOK_DEPS }, payload);
      });
    });

  hook
    .command("codex-user-prompt")
    .description("Codex UserPromptSubmit: read-evidence + heartbeat.")
    .action(async () => {
      const status = host.status();
      const payload = userPromptPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookUserPrompt({ db, repoRoot, status, ...CODEX_HOOK_DEPS }, payload);
      });
    });

  hook
    .command("codex-stop")
    .description("Codex Stop: heartbeat at turn end (delivery via app-server/queue).")
    .action(async () => {
      const status = host.status();
      const payload = stopPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        const agentId = runHookStop({ db, repoRoot, status, ...CODEX_HOOK_DEPS }, payload);
        // Backstop for messages that arrived while this turn ran: Stop fires just
        // before the turn ends, so a detached wake waits for idle, then delivers.
        if (agentId !== null && messagesRepo.listUndeliveredForRecipient(db, agentId, Date.now()).length > 0) {
          host.wakeCodex(agentId, STOP_WAKE_WAIT_S);
        }
      });
    });

  hook
    .command("codex-post-tool")
    .description("Codex PostToolUse: heartbeat + record edits (apply_patch/Edit/Write).")
    .action(async () => {
      const status = host.status();
      const payload = postToolPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookPostTool({ db, repoRoot, status, notify: host.notify, ...CODEX_HOOK_DEPS }, payload);
      });
    });

  hook
    .command("codex-session-end")
    .description("Codex SessionEnd: requeue unread delivered messages.")
    .action(async () => {
      const status = host.status();
      const payload = sessionEndPayloadSchema.parse(await host.readStdinJson());
      host.withDb((db, repoRoot) => {
        runHookSessionEnd({ db, repoRoot, status, ...CODEX_HOOK_DEPS }, payload);
      });
    });
}
