#!/usr/bin/env node
/**
 * Idempotently install a Codex SessionStart hook into ~/.codex/hooks.json that
 * runs scripts/setup-worktree.sh whenever a Codex session starts inside a
 * worktree of this monorepo.
 *
 * Why this exists: Claude runs setup-worktree.sh every session via the repo's
 * committed .claude/settings.json SessionStart hook, so the per-worktree plugin
 * build stays current automatically. Codex has no project-scoped plugin
 * enablement, so this user hook selects the dev core in linked worktrees and
 * the production core in main. Uniquely named helper plugins stay enabled in
 * both modes.
 *
 * Usage:
 *   install-session-hook.mjs <hooksJsonPath>
 */

import fs from "node:fs"
import path from "node:path"

const hooksPath = process.argv[2]
if (!hooksPath) {
  console.error("Usage: install-session-hook.mjs <hooksJsonPath>")
  process.exit(2)
}

// Substring that uniquely identifies our entry, so re-runs replace rather than
// duplicate and we never touch Superset's or anyone else's hooks.
const IDENTIFIER = "scripts/setup-worktree.sh"

// In a linked worktree, refresh the dev build. In main, restore only the
// production core; helper plugins remain enabled in both modes.
const COMMAND = [
  "sh -c '",
  'R="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0; ',
  '[ -f "$R/scripts/setup-worktree.sh" ] || exit 0; ',
  'if [ "$(git rev-parse --git-common-dir 2>/dev/null)" != "$(git rev-parse --git-dir 2>/dev/null)" ]; ',
  'then exec env SUPERSET_AGENT_ID=codex bash "$R/scripts/setup-worktree.sh" "$R"; ',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion inside a single-quoted sh command, not a JS template literal
  'else exec node "$R/bitfab-codex-plugin/scripts/codex-config.mjs" restore-prod "${CODEX_HOME:-$HOME/.codex}/config.toml"; fi',
  "'",
].join("")

let data = {}
if (fs.existsSync(hooksPath)) {
  try {
    data = JSON.parse(fs.readFileSync(hooksPath, "utf8"))
  } catch {
    data = {}
  }
}

data.hooks ??= {}
const hooks = data.hooks
const sessionStart = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : []

// Drop any prior entry of ours (matched by the setup-worktree command), keep
// everything else (e.g. Superset's notify hook) untouched.
const kept = sessionStart.filter((group) => {
  const inner = Array.isArray(group?.hooks) ? group.hooks : []
  return !inner.some(
    (h) => typeof h?.command === "string" && h.command.includes(IDENTIFIER),
  )
})

kept.push({
  hooks: [
    {
      type: "command",
      command: COMMAND,
      statusMessage: "Setting up Bitfab worktree",
    },
  ],
})

hooks.SessionStart = kept
data.hooks = hooks

fs.mkdirSync(path.dirname(hooksPath), { recursive: true })
fs.writeFileSync(hooksPath, `${JSON.stringify(data, null, 2)}\n`)
console.log(
  `[install-session-hook] ensured SessionStart -> setup-worktree in ${hooksPath}`,
)
