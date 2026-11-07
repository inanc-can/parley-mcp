import { describe, expect, it } from "vitest";
import { checkStopAll, scanSecret } from "../../src/core/guards.js";

describe("stop-all guard", () => {
  it("blocks every talk call while stop_all is on", () => {
    expect(checkStopAll(true)).toEqual({ ok: false, code: "stop_all" });
  });

  it("allows talk when stop_all is off", () => {
    expect(checkStopAll(false)).toEqual({ ok: true });
  });
});

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

describe("secret scan near-misses (must not block)", () => {
  it("allows an AKIA string with fewer than 16 following characters", () => {
    // One character short of the real 16-character AWS key tail.
    expect(scanSecret("key AKIA000000000000000 here")).toBeNull();
  });

  it("allows a Slack xoxb token with fewer than 10 trailing characters", () => {
    // One character short of the minimum Slack token tail.
    expect(scanSecret("xoxb-123456789")).toBeNull();
  });

  it("allows .env-style lines with short values", () => {
    // One character short of the 12-character minimum value.
    expect(scanSecret("MY_SECRET=abcdefghijk")).toBeNull();
    expect(scanSecret("API_TOKEN=abc")).toBeNull();
    expect(scanSecret("DB_PASSWORD=letmein")).toBeNull();
  });

  it("allows short ghp_ and sk- strings", () => {
    expect(scanSecret("prefix ghp_abcd, see docs")).toBeNull();
    expect(scanSecret("sk-abc")).toBeNull();
  });
});

describe("scanSecret near-misses (must not block)", () => {
  it("lets a too-short AKIA id pass", () => {
    // AKIA requires 16 alphanumeric characters after the prefix.
    expect(scanSecret("AKIA123456789012")).toBeNull();
  });

  it("lets a too-short Slack token pass", () => {
    // xox[baprs]- requires 10+ characters after the dash.
    expect(scanSecret("xoxb-12345")).toBeNull();
  });

  it("lets a short .env-style secret value pass", () => {
    // The value must be 12+ non-space characters.
    expect(scanSecret("SECRET=short")).toBeNull();
  });

  it("still blocks real-looking secrets", () => {
    expect(scanSecret("AKIAIOSFODNN7EXAMPLE")).not.toBeNull();
    expect(scanSecret("ghp_abcdefghijklmnopqrst")).not.toBeNull();
    expect(scanSecret("SECRET=VERYLONGVALUE123")).not.toBeNull();
  });
});
