import { z } from "zod";
import { gateOpenForVersion, versionFromUserAgent } from "./app-server.js";
import { controlSocketPath, openControlSocket, type RpcConnection } from "./control-socket.js";
import { OUR_LAUNCHER_SUFFIX } from "./toml-merge.js";

/**
 * What `doctor` learns from the Codex app-server daemon (verified live,
 * codex 0.154.0): whether it is running, whether it speaks the protocol we
 * verified, and the trust status Codex records for our hooks (`hooks/list`
 * reports `trustStatus: managed | untrusted | trusted | modified`).
 */
export interface DaemonProbe {
  /** The control socket accepted a connection and answered `initialize`. */
  reachable: boolean;
  /** The daemon's version is on the verified protocol track. */
  gateOpen: boolean;
  /** True when every mcp-parley hook is trusted; false when any is not; null when unknown. */
  hooksTrusted: boolean | null;
}

const UNREACHABLE: DaemonProbe = { reachable: false, gateOpen: false, hooksTrusted: null };

const initializeSchema = z.looseObject({ userAgent: z.string() });
const hooksListSchema = z.looseObject({
  data: z.array(
    z.looseObject({
      hooks: z.array(z.looseObject({ command: z.string().nullish(), trustStatus: z.string() })),
    }),
  ),
});

/** Probe the daemon. Never throws; an unreachable daemon is a normal answer. */
export async function probeCodexDaemon(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
  connect: (path: string) => Promise<RpcConnection> = (path) => openControlSocket(path, 2000),
): Promise<DaemonProbe> {
  let conn: RpcConnection;
  try {
    conn = await connect(controlSocketPath(env, home));
  } catch {
    return UNREACHABLE;
  }
  try {
    const init = initializeSchema.parse(
      await conn.request("initialize", { clientInfo: { name: "mcp-parley-doctor", title: "mcp-parley", version: "0.0.0" } }),
    );
    conn.notify("initialized");
    const gateOpen = gateOpenForVersion(versionFromUserAgent(init.userAgent));
    return { reachable: true, gateOpen, hooksTrusted: gateOpen ? await ourHooksTrusted(conn, home) : null };
  } catch {
    return { reachable: true, gateOpen: false, hooksTrusted: null };
  } finally {
    conn.close();
  }
}

/** User-level hooks apply in every folder, so asking for HOME's view is enough. */
async function ourHooksTrusted(conn: RpcConnection, home: string): Promise<boolean | null> {
  const listed = hooksListSchema.safeParse(await conn.request("hooks/list", { cwds: [home] }));
  if (!listed.success) {
    return null;
  }
  const ours = listed.data.data
    .flatMap((entry) => entry.hooks)
    .filter((hook) => hook.command?.includes(OUR_LAUNCHER_SUFFIX) ?? false);
  if (ours.length === 0) {
    return null;
  }
  return ours.every((hook) => hook.trustStatus === "trusted" || hook.trustStatus === "managed");
}
