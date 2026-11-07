import { describe, expect, it } from "vitest";
import { titleFromFirstMessage } from "../../src/core/threads.js";

describe("titleFromFirstMessage", () => {
  it("takes the first line of the first message as the thread title", () => {
    expect(titleFromFirstMessage("ship the parser\nsecond line")).toBe(
      "ship the parser",
    );
    expect(titleFromFirstMessage("  padded  ")).toBe("padded");
  });

  it("trims long titles to the maximum length", () => {
    expect(titleFromFirstMessage("x".repeat(80))).toHaveLength(60);
  });
});
