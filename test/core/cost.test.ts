import { describe, expect, it } from "vitest";
import { costLabel, estimateTokens } from "../../src/core/cost.js";

describe("cost estimate", () => {
  it("estimates tokens as chars/4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("labels as an estimate", () => {
    expect(costLabel(10)).toContain("estimate");
    expect(costLabel(10)).toContain("≈10");
  });
});
