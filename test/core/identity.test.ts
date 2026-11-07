import { describe, expect, it } from "vitest";
import {
  formatAgentId,
  isAlive,
  nextClashId,
  parseAgentId,
} from "../../src/core/identity.js";

describe("identity", () => {
  it("formats and parses agent ids", () => {
    expect(formatAgentId("codex", "api", null)).toBe("codex@api");
    expect(parseAgentId("codex@api")).toEqual({
      id: "codex@api",
      harness: "codex",
      folder: "api",
      suffix: null,
    });
  });

  it("handles clash suffixes", () => {
    expect(formatAgentId("codex", "api", 2)).toBe("codex@api-2");
    expect(parseAgentId("codex@api-2")?.suffix).toBe(2);
    expect(nextClashId("codex", "api", ["codex@api"])).toBe("codex@api-2");
    expect(nextClashId("codex", "api", ["codex@api", "codex@api-2"])).toBe(
      "codex@api-3",
    );
  });
});

describe("presence", () => {
  it("is alive with a heartbeat inside the 30 s window", () => {
    expect(isAlive(1_000, 10_000)).toBe(true);
    expect(isAlive(1_000, 31_000)).toBe(true); // exactly 30 s
    expect(isAlive(1_000, 31_001)).toBe(false);
    expect(isAlive(null, 1_000)).toBe(false);
  });
});
