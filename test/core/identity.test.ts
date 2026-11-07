import { describe, expect, it } from "vitest";
import {
  formatAgentId,
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
