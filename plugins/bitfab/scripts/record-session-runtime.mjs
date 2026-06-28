#!/usr/bin/env node
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const worktree = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd()
const sessionId = [
  process.argv[3],
  process.env.CODEX_THREAD_ID,
  process.env.AGENT_SESSION_ID,
].find((value) => value)

if (!sessionId) {
  process.exit(0)
}

const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")
const outputPath = path.join(
  codexHome,
  "bitfab",
  "sessions",
  `${sessionId}.json`,
)

const runtime = {
  sessionId,
  worktree,
  bitfabRuntime: path.join(worktree, "bitfab-codex-plugin"),
  bitfabDevRuntime: path.join(worktree, "bitfab-dev-codex-plugin"),
  recordedAt: new Date().toISOString(),
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(runtime, null, 2)}\n`)
console.log(`[record-session-runtime] ${sessionId} -> ${worktree}`)
