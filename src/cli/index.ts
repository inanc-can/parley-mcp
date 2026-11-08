import { homedir } from "node:os";
import { Command, Option } from "commander";
import type { AdapterEnv } from "../adapters/index.js";
import { openHubDb, resolveRepoRoot } from "./context.js";
import type { Db } from "../store/index.js";
import { runWho } from "./commands/who.js";
import { runLog } from "./commands/log.js";
import { runExport, type ExportFormat } from "./commands/export.js";
import {
  runInboxDrain,
  runInboxRegister,
  runInboxWatchOnce,
  type DrainFormat,
} from "./commands/inbox.js";
import { registerHookCommands } from "./hook-commands.js";
import { runSetup } from "./commands/setup.js";
import { runUninstall } from "./commands/uninstall.js";
import { runDoctor } from "./commands/doctor.js";
import { parsePort, runViewer } from "./commands/viewer.js";
import { runServe } from "./commands/serve.js";
import { runCodexWake } from "./commands/codex-wake.js";
import { controlSocketPath, openControlSocket } from "../adapters/codex/control-socket.js";
import { spawnCodexWake } from "../adapters/codex/spawn-wake.js";
import { osNotifier } from "../notify/os-notify.js";
import { launcherPath } from "../adapters/cli-path.js";

export const CLI_VERSION = "0.0.0";

const WATCH_POLL_MS = 2000;

export interface CliDeps {
  write: (line: string) => void;
  /**
   * Diagnostic/status output. Defaults to stderr. Hook handlers use this so that
   * nothing but genuine deliveries lands on stdout (Claude Code turns a hook's
   * stdout into model context), keeping the model's context clean.
   */
  status?: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Stdin source for hook payloads (overridable in tests). */
  stdin?: AsyncIterable<Buffer | string>;
}

function defaultDeps(): CliDeps {
  return {
    write: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    status: (line: string) => {
      process.stderr.write(`${line}\n`);
    },
    env: process.env,
    cwd: process.cwd(),
  };
}

/** The diagnostic channel for a CLI invocation (stderr by default). */
function statusWriter(deps: CliDeps): (line: string) => void {
  return deps.status ?? ((line: string) => process.stderr.write(`${line}\n`));
}

function adapterEnv(deps: CliDeps): AdapterEnv {
  return { home: deps.env["HOME"] ?? homedir() };
}

/** Run a command needing the hub db, closing it afterwards. */
function withDb<T>(deps: CliDeps, run: (db: Db, repoRoot: string) => T): T {
  const db = openHubDb(deps.env);
  try {
    return run(db, resolveRepoRoot(deps.cwd));
  } finally {
    db.close();
  }
}

function parseDrainFormat(value: string): DrainFormat {
  return value === "json" ? "json" : "monitor";
}

function parseExportFormat(value: string): ExportFormat {
  return value === "jsonl" ? "jsonl" : "md";
}

export function buildProgram(deps: CliDeps = defaultDeps()): Command {
  const program = new Command();
  program
    .name("mcp-parley")
    .description("Let coding agents find each other, message each other, and settle agreements.")
    .version(CLI_VERSION);

  program
    .command("serve")
    .description("Start the MCP server over stdio (started by harnesses).")
    .action(async () => {
      await runServe({ env: deps.env, cwd: deps.cwd });
    });

  program
    .command("who")
    .description("List the agents in this repo, alive or idle.")
    .action(() => {
      withDb(deps, (db, repoRoot) => {
        runWho({ db, repoRoot, write: deps.write });
      });
    });

  program
    .command("log")
    .description("Print a conversation, or list this repo's threads.")
    .option("--thread <id>", "the thread to print")
    .action((options: { thread?: string }) => {
      withDb(deps, (db, repoRoot) => {
        runLog({ db, repoRoot, write: deps.write, threadId: options.thread });
      });
    });

  program
    .command("export")
    .description("Export this repo's conversations and decisions.")
    .addOption(
      new Option("--format <format>", "md or jsonl").choices(["md", "jsonl"]).makeOptionMandatory(),
    )
    .action((options: { format: string }) => {
      withDb(deps, (db, repoRoot) => {
        runExport({ db, repoRoot, write: deps.write, format: parseExportFormat(options.format) });
      });
    });

  program
    .command("viewer")
    .description("Open the local viewer: watch threads, post as you, pause, veto, stop all.")
    .option("--port <n>", "port to listen on (default: a free port)")
    .option("--no-open", "print the URL without opening a browser")
    .action(async (options: { port?: string; open: boolean }) => {
      const db = openHubDb(deps.env);
      const viewerDeps: Parameters<typeof runViewer>[0] = {
        db,
        repoRoot: resolveRepoRoot(deps.cwd),
        home: adapterEnv(deps).home,
        write: deps.write,
        openBrowser: options.open,
      };
      const port = parsePort(options.port);
      if (port !== undefined) {
        viewerDeps.port = port;
      }
      const handle = await runViewer(viewerDeps);
      const stop = (): void => {
        void handle.close().then(() => {
          db.close();
          process.exit(0);
        });
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });

  program
    .command("doctor")
    .description("Per-harness: installed? can it wake an idle session?")
    .action(async () => {
      await runDoctor({ env: adapterEnv(deps), write: deps.write });
    });

  program
    .command("setup")
    .description("Detect harnesses and install their adapters (user-level only).")
    .option("--harness <name>", "only set up this harness")
    .option("--dry-run", "list changes without writing anything")
    .action(async (options: { harness?: string; dryRun?: boolean }) => {
      await runSetup({
        env: adapterEnv(deps),
        write: deps.write,
        harness: options.harness,
        dryRun: options.dryRun ?? false,
      });
    });

  program
    .command("uninstall")
    .description("Remove exactly what setup added.")
    .action(async () => {
      await runUninstall({ env: adapterEnv(deps), write: deps.write });
    });

  registerAdapterCommands(program, deps);
  return program;
}

function registerAdapterCommands(program: Command, deps: CliDeps): void {
  const inbox = program
    .command("inbox")
    .description("Used by adapters: drain, watch or register an agent.");

  inbox
    .command("drain")
    .requiredOption("--agent <id>", "the agent whose inbox to drain")
    .addOption(
      new Option("--format <format>", "monitor or json").choices(["monitor", "json"]).default("monitor"),
    )
    .option("--session <native>", "the delivering native session id")
    .action((options: { agent: string; format: string; session?: string }) => {
      withDb(deps, (db, repoRoot) => {
        runInboxDrain(
          { db, repoRoot, write: deps.write },
          options.agent,
          parseDrainFormat(options.format),
          options.session ?? null,
        );
      });
    });

  inbox
    .command("watch")
    .requiredOption("--agent <id>", "the agent whose inbox to watch")
    .addOption(
      new Option("--format <format>", "monitor or json").choices(["monitor", "json"]).default("monitor"),
    )
    .option("--session <native>", "the delivering native session id")
    .option("--once", "print one message then exit")
    .option("--provider <name>", "the harness running the watch (informational, e.g. grok)")
    .action(
      async (options: { agent: string; format: string; session?: string; once?: boolean }) => {
        await watchLoop(deps, options);
      },
    );

  inbox
    .command("register")
    .requiredOption("--agent <id>", "the agent to register")
    .option("--session <native>", "the native session id")
    .action((options: { agent: string; session?: string }) => {
      withDb(deps, (db, repoRoot) => {
        runInboxRegister(
          { db, repoRoot, write: deps.write },
          options.agent,
          options.session ?? null,
        );
      });
    });

  program
    .command("codex-wake")
    .description("Used by the Codex adapter: wake an idle Codex session to read its messages.")
    .requiredOption("--agent <id>", "the Codex agent to wake")
    .option("--wait-s <seconds>", "how long to wait for a busy turn to end", "60")
    .action(async (options: { agent: string; waitS: string }) => {
      const db = openHubDb(deps.env);
      try {
        await runCodexWake(
          {
            db,
            connect: () => openControlSocket(controlSocketPath(deps.env, adapterEnv(deps).home)),
            status: statusWriter(deps),
            waitMs: Math.max(0, Number(options.waitS) || 0) * 1000,
          },
          options.agent,
        );
      } finally {
        db.close();
      }
    });

  registerHookCommands(program, {
    withDb: (run) => withDb(deps, run),
    status: () => statusWriter(deps),
    readStdinJson: () => readStdinJson(deps),
    env: deps.env,
    wakeCodex: spawnCodexWake(adapterEnv(deps).home),
    notify: osNotifier({ env: deps.env }),
    payloadHost: {
      withDbAt: (dir, run) => withDb({ ...deps, cwd: dir }, run),
      status: () => statusWriter(deps),
      readStdinJson: () => readStdinJson(deps),
      write: deps.write,
      env: deps.env,
      launcher: launcherPath(adapterEnv(deps).home),
      notify: osNotifier({ env: deps.env }),
      wakeCodex: spawnCodexWake(adapterEnv(deps).home),
    },
  });
}

/** Read all of stdin and parse it as JSON (the hook payload). */
async function readStdinJson(deps: CliDeps): Promise<unknown> {
  const stream = deps.stdin ?? process.stdin;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) {
    throw new Error("hook payload: empty stdin");
  }
  return JSON.parse(text);
}

interface WatchOptions {
  agent: string;
  format: string;
  session?: string | undefined;
  once?: boolean | undefined;
}

async function watchLoop(deps: CliDeps, options: WatchOptions): Promise<void> {
  const format = parseDrainFormat(options.format);
  const session = options.session ?? null;
  for (;;) {
    const found = withDb(deps, (db, repoRoot) =>
      runInboxWatchOnce({ db, repoRoot, write: deps.write }, options.agent, format, session),
    );
    if (found.found && options.once === true) {
      return;
    }
    if (found.found && options.once !== true) {
      continue;
    }
    if (options.once !== true) {
      await sleep(WATCH_POLL_MS);
      continue;
    }
    // --once with nothing yet: keep polling until one arrives.
    await sleep(WATCH_POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
