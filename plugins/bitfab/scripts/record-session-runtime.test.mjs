import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "record-session-runtime.mjs",
)

let oldCodexHome
let oldThreadId
let oldAgentSessionId
let tmp
let codexHome
let worktree

beforeEach(() => {
  oldCodexHome = process.env.CODEX_HOME
  oldThreadId = process.env.CODEX_THREAD_ID
  oldAgentSessionId = process.env.AGENT_SESSION_ID
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-script-")),
  )
  codexHome = path.join(tmp, "codex-home")
  worktree = path.join(tmp, "worktree")
  fs.mkdirSync(worktree, { recursive: true })
  process.env.CODEX_HOME = codexHome
  delete process.env.CODEX_THREAD_ID
  delete process.env.AGENT_SESSION_ID
})

afterEach(() => {
  if (oldCodexHome === undefined) {
    delete process.env.CODEX_HOME
  } else {
    process.env.CODEX_HOME = oldCodexHome
  }
  if (oldThreadId === undefined) {
    delete process.env.CODEX_THREAD_ID
  } else {
    process.env.CODEX_THREAD_ID = oldThreadId
  }
  if (oldAgentSessionId === undefined) {
    delete process.env.AGENT_SESSION_ID
  } else {
    process.env.AGENT_SESSION_ID = oldAgentSessionId
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("record-session-runtime", () => {
  it("writes a Codex session runtime mapping", () => {
    execFileSync("node", [SCRIPT, worktree, "session-a"], { stdio: "pipe" })

    const recorded = JSON.parse(
      fs.readFileSync(
        path.join(codexHome, "bitfab", "sessions", "session-a.json"),
        "utf8",
      ),
    )
    expect(recorded).toMatchObject({
      sessionId: "session-a",
      worktree,
      bitfabRuntime: path.join(worktree, "bitfab-codex-plugin"),
      bitfabDevRuntime: path.join(worktree, "bitfab-dev-codex-plugin"),
    })
  })

  it("falls back to AGENT_SESSION_ID when no session argument is passed", () => {
    process.env.AGENT_SESSION_ID = "agent-session-a"
    execFileSync("node", [SCRIPT, worktree], { stdio: "pipe" })

    const recorded = JSON.parse(
      fs.readFileSync(
        path.join(codexHome, "bitfab", "sessions", "agent-session-a.json"),
        "utf8",
      ),
    )
    expect(recorded).toMatchObject({
      sessionId: "agent-session-a",
      worktree,
    })
  })

  it("ignores an empty session argument when env has a session id", () => {
    process.env.AGENT_SESSION_ID = "agent-session-b"
    execFileSync("node", [SCRIPT, worktree, ""], { stdio: "pipe" })

    const recorded = JSON.parse(
      fs.readFileSync(
        path.join(codexHome, "bitfab", "sessions", "agent-session-b.json"),
        "utf8",
      ),
    )
    expect(recorded).toMatchObject({
      sessionId: "agent-session-b",
      worktree,
    })
  })
})
