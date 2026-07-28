import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)
const SCRIPT = path.join(REPO_ROOT, "scripts", "setup-worktree.sh")

let tmp
let fakeBin
let callsPath
let linkedWorktree

function setupEnv() {
  return {
    ...process.env,
    AGENT_SESSION_ID: "",
    CLAUDECODE: "",
    CODEX_CI: "",
    CODEX_SANDBOX: "",
    CODEX_THREAD_ID: "",
    CURSOR_TRACE_ID: "",
    HOME: path.join(tmp, "home"),
    PATH: `${fakeBin}:${process.env.PATH}`,
    SUPERSET_AGENT_ID: "",
    UNEXPECTED_CALLS: callsPath,
  }
}

function createLinkedWorktree() {
  fs.writeFileSync(path.join(tmp, "README.md"), "fixture\n")
  execFileSync("git", ["-C", tmp, "add", "README.md"])
  execFileSync(
    "git",
    [
      "-C",
      tmp,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "fixture",
    ],
    { stdio: "pipe" },
  )
  execFileSync("git", [
    "-C",
    tmp,
    "worktree",
    "add",
    "-q",
    "-b",
    "test-linked",
    linkedWorktree,
  ])
}

function configureSuccessfulNeon() {
  const neonctl = path.join(fakeBin, "neonctl")
  fs.writeFileSync(
    neonctl,
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "neonctl $*" >> "$UNEXPECTED_CALLS"
if [ "\${1:-} \${2:-}" = "branches create" ]; then
  printf '{}\\n'
elif [ "\${1:-}" = "connection-string" ]; then
  printf '%s\\n' 'postgresql://owner:password@ep-test-branch.us-west-2.aws.neon.tech/neondb?sslmode=require'
else
  exit 99
fi
`,
  )
  fs.chmodSync(neonctl, 0o755)
}

function configureSuccessfulPnpm() {
  const pnpm = path.join(fakeBin, "pnpm")
  fs.writeFileSync(
    pnpm,
    `#!/bin/bash
printf '%s\\n' "pnpm $*" >> "$UNEXPECTED_CALLS"
exit 0
`,
  )
  fs.chmodSync(pnpm, 0o755)
}

function writeWorktreeEnv(content = "") {
  fs.writeFileSync(
    path.join(linkedWorktree, ".env.development"),
    `NEON_PARENT_BRANCH=main
${content}`,
  )
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "setup-worktree-lifecycle-"))
  linkedWorktree = `${tmp}-linked`
  fakeBin = path.join(tmp, "fake-bin")
  callsPath = path.join(tmp, "unexpected-calls.log")
  fs.mkdirSync(fakeBin)
  execFileSync("git", ["init", "-q", tmp])

  for (const command of ["gh", "gt", "neonctl", "pnpm"]) {
    const commandPath = path.join(fakeBin, command)
    fs.writeFileSync(
      commandPath,
      `#!/bin/bash
printf '%s\\n' "${command} $*" >> "$UNEXPECTED_CALLS"
exit 99
`,
    )
    fs.chmodSync(commandPath, 0o755)
  }
})

afterEach(() => {
  fs.rmSync(linkedWorktree, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("setup-worktree lifecycle", () => {
  it("skips portable setup in the main repository", () => {
    const output = execFileSync("bash", [SCRIPT, "--session", tmp], {
      env: setupEnv(),
    }).toString()

    expect(output).toContain("main repo, skipping portable core")
    expect(fs.existsSync(callsPath)).toBe(false)
  })

  it("never runs creation setup during a linked-worktree session", () => {
    createLinkedWorktree()

    const output = execFileSync("bash", [SCRIPT, "--session", linkedWorktree], {
      env: setupEnv(),
    }).toString()

    expect(output).toContain("session mode, skipping creation setup")
    expect(fs.existsSync(callsPath)).toBe(false)
  })

  it("treats a legacy no-mode invocation as a session", () => {
    createLinkedWorktree()

    const output = execFileSync("bash", [SCRIPT, linkedWorktree], {
      env: setupEnv(),
    }).toString()

    expect(output).toContain("session mode, skipping creation setup")
    expect(fs.existsSync(callsPath)).toBe(false)
  })

  it("keeps creation setup available through explicit all mode", () => {
    createLinkedWorktree()
    configureSuccessfulNeon()
    writeWorktreeEnv(
      "DATABASE_URL='postgresql://owner:password@ep-main-branch.us-west-2.aws.neon.tech/neondb'\n",
    )

    const output = execFileSync("bash", [SCRIPT, "--all", linkedWorktree], {
      env: setupEnv(),
    }).toString()

    expect(output).toContain("rewrote DATABASE_URL")
    expect(output).not.toContain("session mode, skipping creation setup")
    expect(fs.readFileSync(callsPath, "utf8")).toContain(
      "neonctl branches create",
    )
  })

  it("keeps Neon creation idempotent when creation runs again", () => {
    createLinkedWorktree()
    configureSuccessfulNeon()
    writeWorktreeEnv(
      "DATABASE_URL='postgresql://owner:password@ep-main-branch.us-west-2.aws.neon.tech/neondb'\n",
    )

    const first = execFileSync("bash", [SCRIPT, "--create", linkedWorktree], {
      env: setupEnv(),
    }).toString()

    expect(first).toContain("creation setup complete")
    expect(fs.readFileSync(callsPath, "utf8")).toContain(
      "neonctl branches create",
    )

    fs.rmSync(callsPath, { force: true })
    const second = execFileSync("bash", [SCRIPT, "--create", linkedWorktree], {
      env: setupEnv(),
    }).toString()

    expect(second).toContain("creation setup complete")
    expect(fs.readFileSync(callsPath, "utf8")).toContain(
      "neonctl branches create",
    )
  })

  it("retries an unfinished section after creation fails", () => {
    createLinkedWorktree()
    configureSuccessfulNeon()
    writeWorktreeEnv()

    expect(() =>
      execFileSync("bash", [SCRIPT, "--create", linkedWorktree], {
        env: setupEnv(),
      }),
    ).toThrow()

    writeWorktreeEnv(
      "DATABASE_URL='postgresql://owner:password@ep-main-branch.us-west-2.aws.neon.tech/neondb'\n",
    )
    fs.rmSync(callsPath, { force: true })

    const retry = execFileSync("bash", [SCRIPT, "--create", linkedWorktree], {
      env: setupEnv(),
    }).toString()

    expect(retry).toContain("creation setup complete")
    expect(fs.readFileSync(callsPath, "utf8")).toContain(
      "neonctl branches create",
    )
  })

  it("repairs dev API keys when the Clerk mirror email is missing", () => {
    createLinkedWorktree()
    configureSuccessfulNeon()
    configureSuccessfulPnpm()
    fs.mkdirSync(path.join(linkedWorktree, "bitfab-web"))
    fs.writeFileSync(
      path.join(linkedWorktree, "bitfab-web", "package.json"),
      "{}\n",
    )
    writeWorktreeEnv(
      "DATABASE_URL='postgresql://owner:password@ep-main-branch.us-west-2.aws.neon.tech/neondb'\n",
    )

    const output = execFileSync("bash", [SCRIPT, "--create", linkedWorktree], {
      env: setupEnv(),
    }).toString()
    const calls = fs.readFileSync(callsPath, "utf8")

    expect(output).toContain("dev API keys ensured")
    expect(calls).toContain("with-env tsx scripts/dataFixes/ensureDevApiKey.ts")
    expect(calls).not.toContain("mirrorProdOrgsToDev.ts")
  })

  it("uses explicit lifecycle modes at every committed caller", () => {
    const superset = fs.readFileSync(
      path.join(REPO_ROOT, ".superset", "config.json"),
      "utf8",
    )
    const claude = fs.readFileSync(
      path.join(REPO_ROOT, ".claude", "settings.json"),
      "utf8",
    )
    const codex = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "bitfab-codex-plugin",
        "scripts",
        "install-session-hook.mjs",
      ),
      "utf8",
    )

    expect(superset).toContain("setup-worktree.sh --create")
    expect(claude).toContain("setup-worktree.sh --session")
    expect(codex).toContain('setup-worktree.sh" --session')
  })
})
