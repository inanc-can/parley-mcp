import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * OS notifications for the human (PLAN section 9): accepted agreements,
 * conflicts and paused threads. macOS uses `osascript`, Linux `notify-send`
 * when installed, Windows nothing in v1. Message content never goes beyond a
 * 60-character preview. A notification that cannot be shown is dropped
 * silently: it must never break the agent's tool call or hook.
 */

export type NoticeKind = "agreement" | "conflict" | "paused";

export interface Notice {
  kind: NoticeKind;
  title: string;
  body: string;
}

export type Notifier = (notice: Notice) => void;

/** PLAN section 9: never more than a 60-character preview of message content. */
export const PREVIEW_LIMIT = 60;

export function preview(text: string, limit: number = PREVIEW_LIMIT): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}

export function pausedNotice(threadTitle: string, cap: number): Notice {
  return {
    kind: "paused",
    title: "Parley: thread paused",
    body: `"${preview(threadTitle)}" reached its ${String(cap)}-message cap. Resume or close it in the viewer.`,
  };
}

export function agreementNotice(offeredBy: string, acceptedBy: string, text: string): Notice {
  return {
    kind: "agreement",
    title: "Parley: agreement accepted",
    body: `${acceptedBy} accepted ${offeredBy}'s offer: "${preview(text)}". Veto it in the viewer if needed.`,
  };
}

export function conflictNotice(path: string, editor: string, others: readonly string[]): Notice {
  return {
    kind: "conflict",
    title: "Parley: overlapping work",
    body: `${editor} edited ${preview(path)}, which ${others.join(", ")} also claimed or edited.`,
  };
}

export interface OsNotifierDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Start the command detached; injected in tests. */
  run?: (command: string, args: string[]) => void;
  /** Whether a command is on PATH; injected in tests. */
  onPath?: (command: string) => boolean;
}

/**
 * The real notifier. Text goes to the OS as command arguments, never spliced
 * into a script, so a message cannot inject AppleScript or shell syntax.
 */
export function osNotifier(deps: OsNotifierDeps = {}): Notifier {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const run = deps.run ?? runDetached;
  const onPath = deps.onPath ?? ((command: string) => commandOnPath(command, env));
  return (notice) => {
    try {
      if (platform === "darwin") {
        run("osascript", [
          "-e",
          "on run argv",
          "-e",
          "display notification (item 1 of argv) with title (item 2 of argv)",
          "-e",
          "end run",
          notice.body,
          notice.title,
        ]);
      } else if (platform === "linux" && onPath("notify-send")) {
        run("notify-send", ["--app-name=Parley", notice.title, notice.body]);
      }
      // Windows and others: nothing in v1 (PLAN section 9).
    } catch {
      // never let a notification break the caller
    }
  };
}

/** A notifier that does nothing (tests, and callers without a human to tell). */
export const silentNotifier: Notifier = () => undefined;

function runDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}

function commandOnPath(command: string, env: NodeJS.ProcessEnv): boolean {
  return (env["PATH"] ?? "").split(delimiter).some((dir) => dir.length > 0 && existsSync(join(dir, command)));
}
