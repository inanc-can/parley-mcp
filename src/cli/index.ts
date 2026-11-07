import { homedir } from "node:os";
import { Command } from "commander";
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
import { runHookEdit } from "./commands/hook.js";
import { runSetup } from "./commands/setup.js";
import { runUninstall } from "./commands/uninstall.js";
import { runDoctor } from "./commands/doctor.js";
import { runViewer } from "./commands/viewer.js";
import { runServe } from "./commands/serve.js";

export const CLI_VERSION = "0.0.0";

const WATCH_POLL_MS = 2000;

export interface CliDeps {
  write: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
}

function defaultDeps(): CliDeps {
  return {
    write: (line: string) => {
      process.stdout.write(`${line}\n`);
    },
    env: process.env,
    cwd: process.cwd(),
  };
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
    .name("parley-mcp")
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
    .requiredOption("--format <format>", "md or jsonl")
    .action((options: { format: string }) => {
      withDb(deps, (db, repoRoot) => {
        runExport({ db, repoRoot, write: deps.write, format: parseExportFormat(options.format) });
      });
    });

  program
    .command("viewer")
    .description("Start the local viewer (arrives in M6).")
    .option("--port <n>", "port to listen on")
    .action(() => {
      runViewer({ write: deps.write });
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
    .option("--format <format>", "monitor or json", "monitor")
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
    .option("--format <format>", "monitor or json", "monitor")
    .option("--session <native>", "the delivering native session id")
    .option("--once", "print one message then exit")
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

  const hook = program.command("hook").description("Used by adapters: record harness events.");

  hook
    .command("edit")
    .requiredOption("--agent <id>", "the editing agent")
    .requiredOption("--path <path>", "the edited path")
    .action((options: { agent: string; path: string }) => {
      withDb(deps, (db, repoRoot) => {
        runHookEdit({ db, repoRoot, write: deps.write }, options.agent, options.path);
      });
    });
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
