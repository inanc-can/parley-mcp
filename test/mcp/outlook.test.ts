import { describe, expect, it } from "vitest";
import { buildOutlook, pluralOutlook } from "../../src/mcp/outlook.js";

describe("buildOutlook", () => {
  const now = 100_000;

  it("says a recipient that has never checked in is queued", () => {
    expect(buildOutlook("b@r", undefined, now)).toBe(
      "b@r has never checked in; the message is queued until it does, expires in 24 h.",
    );
  });

  it("says an active recipient should see it at its next tool call", () => {
    expect(buildOutlook("b@r", { lastHeartbeat: now - 30 * 1000 }, now)).toBe(
      "b@r is active right now; it should see this at its next tool call.",
    );
  });

  it("says an idle recipient is queued until its next check", () => {
    const outlook = buildOutlook("b@r", { lastHeartbeat: 1 }, now);
    expect(outlook).toContain("b@r was last seen 100 s ago and is idle");
    expect(outlook).toContain("queued until its next check, expires in 24 h.");
  });
});

describe("pluralOutlook", () => {
  it("returns the single outlook for one recipient", () => {
    expect(pluralOutlook(["b@r"], ["b@r is active right now"])).toBe(
      "b@r is active right now",
    );
  });

  it("joins per-agent outlooks for several recipients", () => {
    expect(
      pluralOutlook(["a@r", "b@r"], ["a out", "b out"]),
    ).toBe("Sent to 2 agents. a out b out");
  });
});
