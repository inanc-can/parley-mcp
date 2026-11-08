# Telemetry

**Parley MCP sends nothing anywhere.** There is no telemetry code in this project.

## The decision (PLAN.md, "The human stays in control")

If telemetry is ever added it will be **opt-in anonymous counts, off by default**: for example how
many messages were sent per day and which harnesses are installed. Never message content, file
paths, agent names, repository names or anything that identifies a person or a project.

## Why it is not built (milestone M11)

Sending counts needs a server to receive them, and this project has no hosted service. Until the
maintainer decides to run one and writes down exactly what is collected, nothing is built.

## What exists today

- A setting, `telemetry_opt_in`, stored in the local SQLite hub (`~/.mcp-parley/hub.db`). It
  defaults to `false`, and nothing reads it to send data.
- A test (`test/no-network.test.ts`) that fails if source code starts making network calls beyond
  the local ones the tool needs: the viewer listening on `127.0.0.1`, the viewer page calling that
  same local server, and the Codex app-server's local Unix socket.

Any future sending code must be proposed in an issue first, with the exact payload, and be reviewed
by the maintainer before it is written.
