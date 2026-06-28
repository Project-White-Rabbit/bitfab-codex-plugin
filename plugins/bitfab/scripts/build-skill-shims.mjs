#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const [, , sourceSkillsDir, targetSkillsDir, runtimeKey] = process.argv

if (!sourceSkillsDir || !targetSkillsDir || !runtimeKey) {
  console.error(
    "Usage: build-skill-shims.mjs <sourceSkillsDir> <targetSkillsDir> <bitfabRuntime|bitfabDevRuntime>",
  )
  process.exit(2)
}

if (runtimeKey !== "bitfabRuntime" && runtimeKey !== "bitfabDevRuntime") {
  console.error("runtimeKey must be bitfabRuntime or bitfabDevRuntime")
  process.exit(2)
}

function frontmatter(markdown, filePath) {
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  if (!match) {
    throw new Error(`Missing frontmatter in ${filePath}`)
  }
  return match[0].replace(/\r?\n?$/, "\n")
}

function shimBody(skillName) {
  return `# Session-routed Bitfab skill shim

This installed skill is a stable Codex shim. Do not execute this shim as the real workflow. Before acting, load the worktree-local skill instructions for this Codex session and follow those instructions instead.

Resolve the current session runtime:

\`\`\`bash
SESSION_ID="\${CODEX_THREAD_ID:-}"
if [ -z "$SESSION_ID" ]; then
  SESSION_ID="$(printf '%s\\n' "$AGENT_SESSION_ID" 2>/dev/null || true)"
fi
RUNTIME_FILE="\${CODEX_HOME:-$HOME/.codex}/bitfab/sessions/$SESSION_ID.json"
RUNTIME_FILE="$RUNTIME_FILE" RUNTIME_KEY="${runtimeKey}" SKILL_NAME="${skillName}" node -e '
  const fs = require("fs");
  const path = process.env.RUNTIME_FILE;
  const key = process.env.RUNTIME_KEY;
  const skill = process.env.SKILL_NAME;
  const runtime = JSON.parse(fs.readFileSync(path, "utf8"));
  console.log(runtime[key] + "/skills/" + skill + "/SKILL.md");
'
\`\`\`

Read the printed \`SKILL.md\` completely, then follow it for this invocation. If the session runtime file is missing, first run:

\`\`\`bash
node "$(git rev-parse --show-toplevel)/bitfab-codex-plugin/scripts/record-session-runtime.mjs" "$(git rev-parse --show-toplevel)" "\${CODEX_THREAD_ID:-\${AGENT_SESSION_ID:-}}"
\`\`\`

Then resolve and read the worktree-local skill again. If the worktree-local skill does not exist, stop and report that this branch does not provide \`${skillName}\` for \`${runtimeKey}\`.
`
}

fs.rmSync(targetSkillsDir, { recursive: true, force: true })
fs.mkdirSync(targetSkillsDir, { recursive: true })

for (const entry of fs.readdirSync(sourceSkillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue
  }
  const skillName = entry.name
  const sourcePath = path.join(sourceSkillsDir, skillName, "SKILL.md")
  if (!fs.existsSync(sourcePath)) {
    continue
  }
  const targetDir = path.join(targetSkillsDir, skillName)
  fs.mkdirSync(targetDir, { recursive: true })
  const source = fs.readFileSync(sourcePath, "utf8")
  fs.writeFileSync(
    path.join(targetDir, "SKILL.md"),
    `${frontmatter(source, sourcePath)}\n${shimBody(skillName)}`,
  )
}
