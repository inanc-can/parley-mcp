import { describe, expect, it } from "vitest";
import type { RpcConnection } from "../../src/adapters/codex/control-socket.js";
import { probeCodexDaemon } from "../../src/adapters/codex/daemon-probe.js";

const OURS = "/home/u/.mcp-parley/bin/mcp-parley";

function conn(userAgent: string, hooks: { command: string; trustStatus: string }[]): RpcConnection {
  return {
    request(method) {
      if (method === "initialize") {
        return Promise.resolve({ userAgent });
      }
      if (method === "hooks/list") {
        return Promise.resolve({ data: [{ cwd: "/home/u", hooks }] });
      }
      return Promise.reject(new Error(method));
    },
    notify: () => undefined,
    close: () => undefined,
  };
}

const probe = (c: RpcConnection | Error) =>
  probeCodexDaemon("/home/u", {}, () => (c instanceof Error ? Promise.reject(c) : Promise.resolve(c)));

describe("probeCodexDaemon", () => {
  it("reports an unreachable daemon without throwing", async () => {
    expect(await probe(new Error("ENOENT"))).toEqual({ reachable: false, gateOpen: false, hooksTrusted: null });
  });

  it("reads trust for our hooks only, ignoring the user's own", async () => {
    const ua = "codex-tui/0.154.0 (x) linux";
    const mixed = [
      { command: `"${OURS}" hook codex-stop`, trustStatus: "trusted" },
      { command: "/usr/bin/their-hook", trustStatus: "untrusted" },
    ];
    expect(await probe(conn(ua, mixed))).toEqual({ reachable: true, gateOpen: true, hooksTrusted: true });
    const modified = [{ command: `"${OURS}" hook codex-stop`, trustStatus: "modified" }];
    expect((await probe(conn(ua, modified))).hooksTrusted).toBe(false);
    expect((await probe(conn(ua, []))).hooksTrusted).toBeNull();
  });

  it("closes the gate on an unverified version and does not ask about hooks", async () => {
    expect(await probe(conn("codex-tui/0.170.1 (x) linux", []))).toEqual({
      reachable: true,
      gateOpen: false,
      hooksTrusted: null,
    });
  });
});
