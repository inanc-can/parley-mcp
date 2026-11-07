import { describe, expect, it } from "vitest";

import { parleyVersion } from "../src/index.js";

describe("scaffold", () => {
  it("exports a version", () => {
    expect(parleyVersion).toBe("0.0.0");
  });
});
