import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { z } from "zod";
import {
  VERIFIED_CODEX_VERSION,
  buildTurnStart,
  buildTurnSteer,
  gateOpenForVersion,
  parseCodexVersion,
  planWake,
  versionFromUserAgent,
  type WakeContext,
} from "../../src/adapters/codex/app-server.js";

/**
 * The generated app-server schema (vendored from
 * `codex app-server generate-json-schema`, codex 0.154.0) is the source of
 * truth for the required fields. We read the two relevant schema files, copied
 * verbatim into fixtures/schema/, so the request builders are checked against
 * the real protocol and the test is self-contained on CI (which has no codex).
 */
const SCHEMA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "adapters",
  "codex",
  "fixtures",
  "schema",
);

const schemaRequired = z.looseObject({ required: z.array(z.string()) });

function requiredFields(file: string): string[] {
  return schemaRequired.parse(JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8"))).required;
}

describe("turn/start request builder", () => {
  it("includes every field the generated TurnStartParams marks required", () => {
    const req = buildTurnStart(1, "thread-123", "hi codex");
    expect(req.method).toBe("turn/start");
    expect(req.jsonrpc).toBe("2.0");
    for (const field of requiredFields("TurnStartParams.json")) {
      expect(Object.prototype.hasOwnProperty.call(req.params, field)).toBe(true);
    }
    expect(req.params["threadId"]).toBe("thread-123");
    expect(req.params["input"]).toEqual([{ type: "text", text: "hi codex" }]);
  });
});

describe("turn/steer request builder", () => {
  it("includes expectedTurnId and every required TurnSteerParams field", () => {
    const req = buildTurnSteer(2, "thread-123", "turn-9", "hi while busy");
    expect(req.method).toBe("turn/steer");
    for (const field of requiredFields("TurnSteerParams.json")) {
      expect(Object.prototype.hasOwnProperty.call(req.params, field)).toBe(true);
    }
    expect(req.params["expectedTurnId"]).toBe("turn-9");
    expect(req.params["threadId"]).toBe("thread-123");
  });
});

describe("planWake fails closed", () => {
  const base: WakeContext = {
    gateOpen: true,
    threadId: "thread-1",
    threadStatus: "idle",
    requestId: 1,
    text: "ping",
  };

  it("falls back with an honest outlook when the gate is shut", () => {
    const plan = planWake({ ...base, gateOpen: false });
    expect(plan.kind).toBe("fallback");
    if (plan.kind === "fallback") {
      expect(plan.outlook).toContain("queued");
    }
  });

  it("falls back when no live thread id is known", () => {
    const plan = planWake({ ...base, threadId: null });
    expect(plan.kind).toBe("fallback");
  });

  it("falls back when the thread is not loaded (its session was closed)", () => {
    const plan = planWake({ ...base, threadStatus: "notLoaded" });
    expect(plan.kind).toBe("fallback");
    if (plan.kind === "fallback") {
      expect(plan.outlook).toContain("not open");
    }
  });

  it("starts a turn on an idle thread", () => {
    const plan = planWake({ ...base, threadStatus: "idle" });
    expect(plan.kind).toBe("turn_start");
    if (plan.kind === "turn_start") {
      expect(plan.request.method).toBe("turn/start");
    }
  });

  it("waits (never steers) while the thread's turn is running", () => {
    const plan = planWake({ ...base, threadStatus: "active" });
    expect(plan.kind).toBe("wait");
  });
});

describe("version gate", () => {
  it("opens only on the verified minor track", () => {
    expect(gateOpenForVersion(VERIFIED_CODEX_VERSION)).toBe(true);
    expect(gateOpenForVersion("0.154.9")).toBe(true); // same minor track
    expect(gateOpenForVersion("0.155.0")).toBe(false); // different minor
    expect(gateOpenForVersion("1.0.0")).toBe(false);
    expect(gateOpenForVersion(null)).toBe(false);
  });

  it("parses the version out of the daemon's initialize userAgent", () => {
    expect(versionFromUserAgent("codex-tui/0.154.0 (Ubuntu 24.4.0; x86_64) linux (probe; 0)")).toBe("0.154.0");
    expect(versionFromUserAgent("garbage")).toBeNull();
  });

  it("parses the version out of `codex --version` output", () => {
    expect(parseCodexVersion("codex-cli 0.154.0")).toBe("0.154.0");
    expect(parseCodexVersion("no version here")).toBeNull();
  });
});
