import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  readCodexSessionRuntime,
  recordCodexSessionRuntime,
  resolveCodexSessionRuntime,
  runtimeServerPath,
  sessionRuntimePath,
} from "./codexSessionRuntime.js"

let oldCodexHome: string | undefined
let oldThreadId: string | undefined
let oldAgentSessionId: string | undefined
let oldSupersetWorkspacePath: string | undefined
let oldSessionLogPath: string | undefined
let tmp: string
let repo: string

beforeEach(() => {
  oldCodexHome = process.env.CODEX_HOME
  oldThreadId = process.env.CODEX_THREAD_ID
  oldAgentSessionId = process.env.AGENT_SESSION_ID
  oldSupersetWorkspacePath = process.env.SUPERSET_WORKSPACE_PATH
  oldSessionLogPath = process.env.CODEX_TUI_SESSION_LOG_PATH
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "codex-runtime-")),
  )
  process.env.CODEX_HOME = path.join(tmp, "codex-home")
  delete process.env.CODEX_THREAD_ID
  delete process.env.AGENT_SESSION_ID
  delete process.env.SUPERSET_WORKSPACE_PATH
  delete process.env.CODEX_TUI_SESSION_LOG_PATH

  repo = path.join(tmp, "worktree")
  fs.mkdirSync(path.join(repo, "nested"), { recursive: true })
  fs.mkdirSync(path.join(repo, "bitfab-codex-plugin", "dist", "mcp"), {
    recursive: true,
  })
  fs.mkdirSync(path.join(repo, "bitfab-dev-codex-plugin"), {
    recursive: true,
  })
  fs.writeFileSync(path.join(repo, "pnpm-workspace.yaml"), "packages: []\n")
  fs.writeFileSync(
    path.join(repo, "bitfab-codex-plugin", "dist", "mcp", "server.js"),
    "console.log('server')\n",
  )
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
  if (oldSupersetWorkspacePath === undefined) {
    delete process.env.SUPERSET_WORKSPACE_PATH
  } else {
    process.env.SUPERSET_WORKSPACE_PATH = oldSupersetWorkspacePath
  }
  if (oldSessionLogPath === undefined) {
    delete process.env.CODEX_TUI_SESSION_LOG_PATH
  } else {
    process.env.CODEX_TUI_SESSION_LOG_PATH = oldSessionLogPath
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("codex session runtime", () => {
  it("records a session-scoped worktree runtime from hook input", () => {
    const runtime = recordCodexSessionRuntime({
      session_id: "session-a",
      cwd: path.join(repo, "nested"),
    })

    expect(runtime).toMatchObject({
      sessionId: "session-a",
      worktree: repo,
      bitfabRuntime: path.join(repo, "bitfab-codex-plugin"),
      bitfabDevRuntime: path.join(repo, "bitfab-dev-codex-plugin"),
    })
    expect(
      JSON.parse(fs.readFileSync(sessionRuntimePath("session-a"), "utf8")),
    ).toMatchObject(runtime ?? {})
  })

  it("reads a previously recorded runtime by session id", () => {
    recordCodexSessionRuntime({
      session_id: "session-a",
      cwd: repo,
    })

    expect(readCodexSessionRuntime("session-a")).toMatchObject({
      sessionId: "session-a",
      worktree: repo,
    })
  })

  it("falls back to CODEX_THREAD_ID when hook input is unavailable", () => {
    process.env.CODEX_THREAD_ID = "thread-a"
    const oldCwd = process.cwd()
    try {
      process.chdir(repo)
      expect(resolveCodexSessionRuntime()).toMatchObject({
        sessionId: "thread-a",
        worktree: repo,
      })
    } finally {
      process.chdir(oldCwd)
    }
  })

  it("falls back to AGENT_SESSION_ID when CODEX_THREAD_ID is unavailable", () => {
    process.env.AGENT_SESSION_ID = "agent-session-a"
    const oldCwd = process.cwd()
    try {
      process.chdir(repo)
      expect(resolveCodexSessionRuntime()).toMatchObject({
        sessionId: "agent-session-a",
        worktree: repo,
      })
    } finally {
      process.chdir(oldCwd)
    }
  })

  it("ignores empty CODEX_THREAD_ID when AGENT_SESSION_ID is available", () => {
    process.env.CODEX_THREAD_ID = ""
    process.env.AGENT_SESSION_ID = "agent-session-b"
    const oldCwd = process.cwd()
    try {
      process.chdir(repo)
      expect(resolveCodexSessionRuntime()).toMatchObject({
        sessionId: "agent-session-b",
        worktree: repo,
      })
    } finally {
      process.chdir(oldCwd)
    }
  })

  it("resolves an unrecorded runtime when MCP has a worktree but no session env", () => {
    const pluginCache = path.join(tmp, "plugin-cache")
    fs.mkdirSync(pluginCache, { recursive: true })
    process.env.SUPERSET_WORKSPACE_PATH = repo

    const oldCwd = process.cwd()
    try {
      process.chdir(pluginCache)
      expect(resolveCodexSessionRuntime()).toMatchObject({
        sessionId: "unknown",
        worktree: repo,
      })
    } finally {
      process.chdir(oldCwd)
    }
  })

  it("does not use parent cwd when current cwd is already a worktree", () => {
    process.env.SUPERSET_WORKSPACE_PATH = path.join(tmp, "missing-worktree")

    const oldCwd = process.cwd()
    try {
      process.chdir(repo)
      expect(resolveCodexSessionRuntime()).toMatchObject({
        sessionId: "unknown",
        worktree: repo,
      })
    } finally {
      process.chdir(oldCwd)
    }
  })

  it("prefers explicit workspace env over plugin-cache fallback", () => {
    const otherRepo = path.join(tmp, "other-worktree")
    fs.mkdirSync(path.join(otherRepo, "bitfab-codex-plugin"), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(otherRepo, "pnpm-workspace.yaml"),
      "packages: []\n",
    )

    const pluginCache = path.join(
      process.env.CODEX_HOME ?? "",
      "plugins",
      "cache",
      "bitfab-internal",
      "bitfab",
      "local",
    )
    fs.mkdirSync(pluginCache, { recursive: true })
    process.env.SUPERSET_WORKSPACE_PATH = otherRepo

    const oldCwd = process.cwd()
    try {
      process.chdir(pluginCache)
      expect(resolveCodexSessionRuntime()).toMatchObject({
        sessionId: "unknown",
        worktree: otherRepo,
      })
    } finally {
      process.chdir(oldCwd)
    }
  })

  it("returns the worktree MCP server path when it exists", () => {
    const runtime = recordCodexSessionRuntime({
      session_id: "session-a",
      cwd: repo,
    })

    expect(runtime ? runtimeServerPath(runtime) : null).toBe(
      path.join(repo, "bitfab-codex-plugin", "dist", "mcp", "server.js"),
    )
  })
})
