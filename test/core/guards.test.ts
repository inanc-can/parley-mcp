import { describe, expect, it } from "vitest";
import { scanSecret } from "../../src/core/guards.js";

describe("secret scan", () => {
  it("allows normal text", () => {
    expect(scanSecret("hello team, please review src/api.ts")).toBeNull();
  });

  it("blocks AWS access keys", () => {
    expect(scanSecret("key AKIA0000000000000000 here")).toEqual({
      kind: "aws_access_key",
    });
  });

  it("blocks GitHub ghp tokens", () => {
    expect(scanSecret("token ghp_aaaaaaaaaaaaaaaaaaaa1234")).toEqual({
      kind: "github_token",
    });
  });

  it("blocks GitHub fine-grained PATs", () => {
    expect(scanSecret("github_pat_aaaaaaaaaaaaaaaaaaaa_bbbbb")).toEqual({
      kind: "github_pat",
    });
  });

  it("blocks OpenAI/Anthropic-style sk- keys", () => {
    expect(scanSecret("use sk-aaaaaaaaaaaaaaaaaaaa1234")).toEqual({
      kind: "openai_or_anthropic_key",
    });
  });

  it("blocks Slack tokens", () => {
    expect(scanSecret("xoxb-1234567890-abcdefghij")).toEqual({
      kind: "slack_token",
    });
  });

  it("blocks private key PEM headers", () => {
    expect(scanSecret("-----BEGIN PRIVATE KEY-----\nabc")).toEqual({
      kind: "private_key_pem",
    });
  });

  it("blocks .env-style SECRET lines with long values", () => {
    expect(scanSecret("MY_SECRET=abcdefghijklmnop")).toEqual({
      kind: "env_secret_line",
    });
  });

  it("blocks .env-style TOKEN lines with long values", () => {
    expect(scanSecret("API_TOKEN=abcdefghijklmnop")).toEqual({
      kind: "env_secret_line",
    });
  });

  it("returns kind only, never the value", () => {
    const match = scanSecret("ghp_aaaaaaaaaaaaaaaaaaaa1234");
    expect(match).toEqual({ kind: "github_token" });
    expect(JSON.stringify(match)).not.toContain("ghp_");
  });
});
