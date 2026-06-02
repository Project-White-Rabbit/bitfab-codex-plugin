# Bitfab Codex Plugin

Bitfab LLM evaluation tools for [OpenAI Codex CLI](https://github.com/openai/codex) — trace inspection, grader management, and SDK setup via MCP, plus `bitfab-setup` and `bitfab-assistant` skills.

**Requires Codex CLI `rust-v0.121.0` or later.**

## Install

```bash
codex plugin marketplace add Project-White-Rabbit/bitfab-codex-plugin
```

`marketplace add` registers the marketplace but does **not** enable the plugin. Open Codex and enable `bitfab@bitfab` in the `/plugins` popup, or edit `~/.codex/config.toml`:

```toml
[plugins."bitfab@bitfab"]
enabled = true
```

Restart Codex. The Bitfab MCP server, skills, and commands load from the plugin.

### Updates

Git marketplaces are re-pulled automatically at Codex startup. To force: `codex plugin marketplace upgrade bitfab`.

### Uninstall

```bash
codex plugin marketplace remove bitfab
```

### Authenticate

Inside Codex, run the `bitfab-setup` skill — handles the browser OAuth flow and stores the API key at `~/.config/bitfab/credentials.json`.

## Architecture

This monorepo houses the dev source. The public repo (`Project-White-Rabbit/bitfab-codex-plugin`) that Codex installs from is produced by `.github/workflows/sync-bitfab-codex-plugin.yml` on every push to `main`:

1. Build `bitfab-plugin-lib` + this plugin.
2. Run `scripts/vendor-bitfab-plugin.sh bitfab-codex-plugin .codex-plugin _target plugins/bitfab`, which:
   - Copies plugin files to `_target/plugins/bitfab/`
   - Inlines `bitfab-plugin-lib/dist` into `_target/plugins/bitfab/node_modules/bitfab-plugin-lib/` (no workspace symlinks — Codex's `copy_dir_recursive` would drop them)
   - Emits `_target/.agents/plugins/marketplace.json` pointing at `./plugins/bitfab` (Codex rejects root-level marketplace sources)
   - Hoists `bitfab-plugin-lib`'s runtime deps into the vendored plugin's `package.json`
3. `pnpm install --prod --ignore-workspace` in the vendored plugin dir.
4. Commit + push to public repo, tag `v<version>`.

Note: the monorepo `bitfab-codex-plugin/` stays flat (mirrors `bitfab-claude-plugin/` and `bitfab-cursor-plugin/` for dev consistency). The `plugins/bitfab/` subdir layout only exists in the vendored output because Codex requires a marketplace-wraps-plugin structure.

## Development

### Build / test

```bash
pnpm --filter bitfab-codex-plugin dev       # tsc --watch
pnpm --filter bitfab-codex-plugin test      # vitest
pnpm --filter bitfab-codex-plugin validate  # lint + tsc + knip + madge
```

### Local install

Codex has no live-from-worktree mode: each rebuild must be vendored and copied into `~/.codex/plugins/cache/bitfab-internal/bitfab/local/`. Run `$bitfab-dev:plugin build` to automate that. `$bitfab-dev:plugin toggle` switches between dev and prod variants (flag is user-global; Codex has no `--scope local`).

### Shared behavior

Behavior shared across editor plugins (login/status/update, MCP proxy to `bitfab.ai/mcp`, handoff tickets) lives in `bitfab-plugin-lib`. The plugin's `mcp.json` launches a local stdio MCP server from `dist/mcp/server.js` that forwards to the HTTP MCP endpoint at `bitfab-web/src/app/mcp/route.ts`. Keep the three editor plugins (Claude, Cursor, Codex) in sync per the rule in the monorepo `CLAUDE.md`.
