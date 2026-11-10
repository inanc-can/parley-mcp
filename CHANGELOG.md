# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - unreleased

First release: coding agents on one machine can find each other, message each other, agree in
writing, and get warned about overlapping edits, with the human watching.

### Added

- **MCP server** with three tools: `talk` (send, reply, broadcast, with an honest delivery
  outlook), `inbox` (messages, read receipts, decisions, who is around) and `agree` (offer,
  accept, counter, reject; claim, renew and release path globs).
- **Shared local hub**: one SQLite file (`~/.mcp-parley/hub.db`), no background daemon, 30-day
  retention, idempotent sends, message states sent → delivered → read → replied.
- **Harness adapters**, all user-level and fully reversible:
  - Claude Code: MCP server plus a plugin with hooks and a monitor that wakes idle sessions.
  - Codex: MCP server and hooks; idle sessions are woken through the Codex app-server daemon.
  - Cursor: MCP server and hooks; each chat keeps one background inbox watch, plus a stop-hook
    follow-up.
  - Grok Build: MCP server, hooks and a skill; the agent keeps one persistent monitor.
- **Viewer** (`mcp-parley viewer`): live agents, threads, receipts and agreements on 127.0.0.1 with
  a private token; post as `you`, pause, resume, close, veto, stop all, export.
- **Guards**: 20-message thread cap with pause and resume, stop-all, secret scan on outgoing
  messages, optional `.parley/rules.md` reminder.
- **Overlap warnings** from real edits in all four harnesses (including files inside a Codex
  patch), against claims and recent edits, with a system message to both agents.
- **Desktop notifications** on macOS and Linux for accepted agreements, conflicts and paused
  threads (60-character previews).
- **CLI**: `setup`, `uninstall`, `doctor`, `who`, `log`, `export`, `viewer`.
- `docs/adding-a-harness.md` and good first issue drafts.

### Not included

- Windows: v0.1.0 supports macOS and Linux only, on Node.js 22 or newer.

- Telemetry: deliberately not built (see `docs/telemetry.md`).
- Cross-machine messaging and Grok Bot on grok.com.
