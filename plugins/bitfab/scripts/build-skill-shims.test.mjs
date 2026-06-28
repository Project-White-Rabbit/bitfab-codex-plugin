import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "build-skill-shims.mjs",
)

let tmp
let sourceSkills
let targetSkills

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-shims-")))
  sourceSkills = path.join(tmp, "source")
  targetSkills = path.join(tmp, "target")
  fs.mkdirSync(path.join(sourceSkills, "evaluate"), { recursive: true })
  fs.writeFileSync(
    path.join(sourceSkills, "evaluate", "SKILL.md"),
    [
      "---",
      "name: evaluate",
      'description: "Evaluate the branch."',
      "---",
      "",
      "# Real instructions",
      "",
    ].join("\n"),
  )
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("build-skill-shims", () => {
  it("preserves frontmatter and writes a session-routed shim body", () => {
    execFileSync("node", [
      SCRIPT,
      sourceSkills,
      targetSkills,
      "bitfabDevRuntime",
    ])

    const shim = fs.readFileSync(
      path.join(targetSkills, "evaluate", "SKILL.md"),
      "utf8",
    )
    expect(shim).toContain("name: evaluate")
    expect(shim).toContain('description: "Evaluate the branch."')
    expect(shim).toContain("stable Codex shim")
    expect(shim).toContain('"bitfabDevRuntime"')
    expect(shim).toContain('"evaluate"')
    expect(shim).not.toContain("# Real instructions")
  })

  it("prints the real worktree skill path from the session runtime", () => {
    execFileSync("node", [
      SCRIPT,
      sourceSkills,
      targetSkills,
      "bitfabDevRuntime",
    ])

    const shim = fs.readFileSync(
      path.join(targetSkills, "evaluate", "SKILL.md"),
      "utf8",
    )
    const resolver = shim.match(/```bash\n([\s\S]*?)\n```/)?.[1]
    if (!resolver) {
      throw new Error("Generated shim is missing a bash resolver")
    }

    const codexHome = path.join(tmp, "codex-home")
    const sessionsDir = path.join(codexHome, "bitfab", "sessions")
    fs.mkdirSync(sessionsDir, { recursive: true })
    fs.writeFileSync(
      path.join(sessionsDir, "test-session.json"),
      JSON.stringify({ bitfabDevRuntime: "/real/worktree/bitfab-dev" }),
    )

    const output = execFileSync("bash", ["-lc", resolver], {
      env: {
        ...process.env,
        AGENT_SESSION_ID: "",
        CODEX_HOME: codexHome,
        CODEX_THREAD_ID: "test-session",
      },
    })
      .toString()
      .trim()

    expect(output).toBe("/real/worktree/bitfab-dev/skills/evaluate/SKILL.md")
  })

  it("accepts CRLF frontmatter", () => {
    fs.mkdirSync(path.join(sourceSkills, "crlf"), { recursive: true })
    fs.writeFileSync(
      path.join(sourceSkills, "crlf", "SKILL.md"),
      [
        "---",
        "name: crlf",
        'description: "CRLF frontmatter."',
        "---",
        "",
        "# Real instructions",
        "",
      ].join("\r\n"),
    )

    execFileSync("node", [SCRIPT, sourceSkills, targetSkills, "bitfabRuntime"])

    const shim = fs.readFileSync(
      path.join(targetSkills, "crlf", "SKILL.md"),
      "utf8",
    )
    expect(shim).toContain("name: crlf")
    expect(shim).toContain('description: "CRLF frontmatter."')
  })
})
