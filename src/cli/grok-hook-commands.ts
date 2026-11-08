import type { Command } from "commander";
import { grokPayloadSchema, grokSession, runGrokHook, type GrokEvent } from "./commands/grok-hooks.js";
import type { PayloadHookHost } from "./cursor-hook-commands.js";

const EVENTS: readonly { name: string; event: GrokEvent; description: string }[] = [
  { name: "grok-session-start", event: "session-start", description: "Grok SessionStart: register the agent." },
  { name: "grok-user-prompt", event: "user-prompt", description: "Grok UserPromptSubmit: read evidence + heartbeat." },
  { name: "grok-post-tool", event: "post-tool", description: "Grok PostToolUse: heartbeat + record edits." },
  { name: "grok-stop", event: "stop", description: "Grok Stop: remind once to start the monitor if none runs." },
  { name: "grok-session-end", event: "session-end", description: "Grok SessionEnd: requeue unread messages." },
];

/**
 * `hook grok-*`. Grok ignores stdout for passive events (docs), so only the
 * Stop reminder prints anything; failures are logged to stderr and never fail
 * the hook (Grok is fail-open either way).
 */
export function registerGrokHookCommands(hook: Command, host: PayloadHookHost): void {
  for (const def of EVENTS) {
    hook
      .command(def.name)
      .description(def.description)
      .action(async () => {
        const status = host.status();
        try {
          const payload = grokPayloadSchema.parse(await host.readStdinJson());
          const where = grokSession(payload, host.env);
          if (where === null) {
            status(`${def.name}: no session id or folder in the payload; ignored`);
            return;
          }
          const reply = host.withDbAt(where.folder, (db, repoRoot) =>
            runGrokHook({ db, repoRoot, status, launcher: host.launcher, notify: host.notify, wakeRecipient: (id, harness) => harness === "codex" && host.wakeCodex(id, 60) }, def.event, payload, where),
          );
          if (reply !== null) {
            host.write(JSON.stringify(reply));
          }
        } catch (error) {
          status(`${def.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
  }
}
