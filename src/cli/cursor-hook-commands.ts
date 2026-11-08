import type { Command } from "commander";
import type { WakeSpawner } from "../adapters/codex/spawn-wake.js";
import type { Notifier } from "../notify/os-notify.js";
import type { Db } from "../store/index.js";
import {
  cursorPayloadSchema,
  cursorSession,
  emptyReply,
  runCursorHook,
  type CursorEvent,
} from "./commands/cursor-hooks.js";

/** What the Cursor and Grok hook commands need from the CLI. */
export interface PayloadHookHost {
  /** Run with the hub db open for the repo containing `dir` (Cursor runs user hooks from ~/.cursor/). */
  withDbAt: <T>(dir: string, run: (db: Db, repoRoot: string) => T) => T;
  status: () => (line: string) => void;
  readStdinJson: () => Promise<unknown>;
  /** stdout: Cursor reads the hook's JSON reply from it. */
  write: (line: string) => void;
  env: NodeJS.ProcessEnv;
  launcher: string;
  notify: Notifier;
  /** Start a detached Codex wake (warned Codex agents see overlap warnings at once). */
  wakeCodex: WakeSpawner;
}

const EVENTS: readonly { name: string; event: CursorEvent; description: string }[] = [
  { name: "cursor-session-start", event: "session-start", description: "Cursor sessionStart: register, and tell the agent to keep one inbox watch running." },
  { name: "cursor-prompt", event: "prompt", description: "Cursor beforeSubmitPrompt: read evidence; always allows the prompt." },
  { name: "cursor-after-edit", event: "after-edit", description: "Cursor afterFileEdit: record the edit (overlap warning)." },
  { name: "cursor-stop", event: "stop", description: "Cursor stop: deliver queued messages as a follow-up." },
  { name: "cursor-session-end", event: "session-end", description: "Cursor sessionEnd: requeue unread messages." },
];

/**
 * `hook cursor-*`: always prints one JSON reply, even when something fails,
 * so a Parley problem can never block the user's prompt or break the chat
 * (diagnostics go to stderr).
 */
export function registerCursorHookCommands(hook: Command, host: PayloadHookHost): void {
  for (const def of EVENTS) {
    hook
      .command(def.name)
      .description(def.description)
      .action(async () => {
        const status = host.status();
        let reply = emptyReply(def.event);
        if (calledByGrok(host.env)) {
          // Grok also runs Cursor's hooks; a Grok session is not a Cursor chat.
          host.write(JSON.stringify(reply));
          return;
        }
        try {
          const payload = cursorPayloadSchema.parse(await host.readStdinJson());
          const where = cursorSession(payload, host.env);
          if (where === null) {
            status(`${def.name}: no conversation id or workspace root in the payload; ignored`);
          } else if (payload.is_background_agent === true) {
            status(`${def.name}: cloud background agent; ignored`);
          } else {
            reply = host.withDbAt(where.root, (db, repoRoot) =>
              runCursorHook({ db, repoRoot, status, launcher: host.launcher, notify: host.notify, wakeRecipient: (id, harness) => harness === "codex" && host.wakeCodex(id, 60) }, def.event, payload, where),
            );
          }
        } catch (error) {
          status(`${def.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
        host.write(JSON.stringify(reply));
      });
  }
}

/**
 * Grok Build reads Claude Code's and Cursor's hook files too (docs.x.ai/build,
 * hooks) and sets GROK_HOOK_EVENT for every hook it runs. Those hooks must do
 * nothing there, or a Grok session would register as a Claude or Cursor agent.
 */
export function calledByGrok(env: NodeJS.ProcessEnv): boolean {
  const event = env["GROK_HOOK_EVENT"];
  return event !== undefined && event.length > 0;
}
