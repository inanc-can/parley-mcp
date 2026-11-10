import { describe, expect, it } from "vitest";

import { parleyVersion } from "../src/index.js";

describe("scaffold", () => {
  it("exports a version", () => {
    expect(parleyVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
