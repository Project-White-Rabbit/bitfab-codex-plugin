import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "install-session-hook.mjs",
)

let dir
let hooksPath

function run() {
  execFileSync("node", [SCRIPT, hooksPath], { stdio: "pipe" })
}

function read() {
  return JSON.parse(fs.readFileSync(hooksPath, "utf8"))
}

function sessionStartCommands(data) {
  return (data.hooks?.SessionStart ?? []).flatMap((g) =>
    (g.hooks ?? []).map((h) => h.command),
  )
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-hooks-"))
  hooksPath = path.join(dir, "hooks.json")
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("install-session-hook", () => {
  it("creates hooks.json with a guarded setup-worktree SessionStart entry", () => {
    run()
    const cmds = sessionStartCommands(read())
    expect(cmds).toHaveLength(1)
    expect(cmds[0]).toContain("scripts/setup-worktree.sh")
    expect(cmds[0]).toContain("SUPERSET_AGENT_ID=codex")
    // self-guards: only fires inside this repo and branches worktree vs main
    expect(cmds[0]).toContain("git rev-parse --git-common-dir")
    expect(cmds[0]).toContain("git rev-parse --git-dir")
    expect(cmds[0]).toContain("restore-prod")
  })

  it("preserves an existing (e.g. Superset) SessionStart hook", () => {
    fs.writeFileSync(
      hooksPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: "command", command: "/superset/notify.sh" }] },
          ],
        },
      }),
    )
    run()
    const cmds = sessionStartCommands(read())
    expect(cmds).toContain("/superset/notify.sh")
    expect(cmds.some((c) => c.includes("scripts/setup-worktree.sh"))).toBe(true)
    expect(cmds).toHaveLength(2)
  })

  it("is idempotent: re-running does not duplicate our entry", () => {
    run()
    run()
    run()
    const cmds = sessionStartCommands(read())
    expect(
      cmds.filter((c) => c.includes("scripts/setup-worktree.sh")),
    ).toHaveLength(1)
  })

  it("survives a malformed hooks.json by starting fresh", () => {
    fs.writeFileSync(hooksPath, "{ not valid json")
    run()
    const cmds = sessionStartCommands(read())
    expect(cmds.some((c) => c.includes("scripts/setup-worktree.sh"))).toBe(true)
  })
})
