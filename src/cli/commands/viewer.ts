import { spawn } from "node:child_process";
import { spawnCodexWake } from "../../adapters/codex/spawn-wake.js";
import type { Db } from "../../store/index.js";
import { startViewer, type ViewerHandle, type ViewerOptions } from "../../viewer/server.js";
import { runExport } from "./export.js";

export interface ViewerDeps {
  db: Db;
  repoRoot: string;
  home: string;
  write: (line: string) => void;
  port?: number;
  /** Open the page in the default browser (macOS `open`, Linux `xdg-open`). */
  openBrowser: boolean;
  /** Injected in tests. */
  start?: (options: ViewerOptions) => Promise<ViewerHandle>;
  launch?: (url: string) => void;
}

/**
 * `mcp-parley viewer [--port n] [--no-open]`: start the local viewer for the
 * repo you are in (PLAN section 8) and print its URL, which carries the access
 * token. It runs until you stop it (Ctrl+C). Posting as `you` wakes Codex
 * recipients the same way `talk` does; Claude Code sessions see posts through
 * their monitor.
 */
export async function runViewer(deps: ViewerDeps): Promise<ViewerHandle> {
  const start = deps.start ?? startViewer;
  const spawnWake = spawnCodexWake(deps.home);
  const options: ViewerOptions = {
    db: deps.db,
    repoRoot: deps.repoRoot,
    wakeRecipient: (agentId, harness) => harness === "codex" && spawnWake(agentId, 60),
    exportLines: (format) => {
      const lines: string[] = [];
      runExport({ db: deps.db, repoRoot: deps.repoRoot, format, write: (line) => lines.push(line) });
      return lines;
    },
  };
  if (deps.port !== undefined) {
    options.port = deps.port;
  }
  const handle = await start(options);
  deps.write(`Parley viewer for ${deps.repoRoot}`);
  deps.write(`  ${handle.url}`);
  deps.write("Keep the link private: the token in it is the only key. Stop with Ctrl+C.");
  if (deps.openBrowser) {
    (deps.launch ?? openInBrowser)(handle.url);
  }
  return handle;
}

/** Best effort; the printed URL is the fallback. Windows does nothing in v1. */
function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "linux" ? "xdg-open" : null;
  if (command === null) {
    return;
  }
  try {
    const child = spawn(command, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // no browser launcher available: the URL was printed
  }
}

/** Parse --port: an integer 1-65535, else undefined (a free port is picked). */
export function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}
