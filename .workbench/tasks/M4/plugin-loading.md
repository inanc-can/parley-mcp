# Claude Code plugin loading: findings (Claude, 2026-11-07)

Source: official docs, checked by a docs agent. Local CLI is Claude Code 2.1.303.

- Copying a folder into `~/.claude/plugins/<name>/` does NOT load a plugin. That root holds
  `cache/`, `marketplaces/`, `installed_plugins.json`, `known_marketplaces.json`; loose folders are
  not a load location. (code.claude.com/docs/en/plugins/loading.md#find-plugins-on-disk)
- Documented install path: wrap the plugin in a local directory marketplace at a STABLE path
  (not a temp dir), then:
    claude plugin validate "$MARKET" --strict
    claude plugin marketplace add "$MARKET" --scope user
    claude plugin install parley@<marketplace-name> --scope user   # writes enabledPlugins
    claude plugin list --json                                     # verify
  Layout: `$MARKET/.claude-plugin/marketplace.json` ({name, owner, plugins:[{name, source:"./plugins/parley"}]})
  and `$MARKET/plugins/parley/` (the plugin). Relative-path plugins load in place.
  (plugins/install.md#install-from-your-shell, cli-reference.md, marketplace-reference.md#marketplace-file)
- Uninstall: `claude plugin uninstall parley@<mkt> --scope user`, then
  `claude plugin marketplace remove <mkt> --scope user`, then remove our own $MARKET folder.
- Monitors are documented (plugins/components.md#monitors): `monitors/monitors.json` is a JSON
  ARRAY of {name, command, description, when?}; unknown keys are an error. Persistent process in the
  session cwd; stdout becomes notifications. Doesn't start under `-p`; not loaded for project-scope
  plugins. Some setups need Claude Code >= 2.1.310 (Bedrock/Vertex/Foundry or telemetry off).
- `--plugin-dir` is per-session only; `enabledPlugins` only toggles an installed plugin.
- Suggested: put the marketplace under `~/.parley-mcp/claude-marketplace/`, run the `claude plugin`
  commands through an injectable command runner so tests never call the real `claude`, and have
  `doctor` run `claude plugin list --json` to confirm the plugin is installed and enabled.
