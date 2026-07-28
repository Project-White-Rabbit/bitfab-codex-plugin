import { execFile, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/ensure-workspace-deps.sh",
)

let repoRoot
let fakeBin
let callsPath

function run() {
  return execFileSync("bash", [SCRIPT, repoRoot], {
    env: {
      ...process.env,
      FAKE_PNPM_CALLS: callsPath,
      FAKE_REPO_ROOT: repoRoot,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  }).toString()
}

function runAsync(env = {}) {
  return execFileAsync("bash", [SCRIPT, repoRoot], {
    env: {
      ...process.env,
      ...env,
      FAKE_PNPM_CALLS: callsPath,
      FAKE_REPO_ROOT: repoRoot,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  })
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-deps-"))
  fakeBin = path.join(repoRoot, "fake-bin")
  callsPath = path.join(repoRoot, "pnpm-calls.log")
  fs.mkdirSync(fakeBin)
  fs.mkdirSync(path.join(repoRoot, "node_modules", ".pnpm"), {
    recursive: true,
  })
  for (const packageDir of [
    "bitfab-flow",
    "bitfab-plugin-lib",
    "bitfab-codex-plugin",
  ]) {
    fs.mkdirSync(path.join(repoRoot, packageDir), { recursive: true })
    fs.writeFileSync(path.join(repoRoot, packageDir, "package.json"), "{}\n")
  }
  fs.writeFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "packages: []\n")
  fs.writeFileSync(
    path.join(repoRoot, "pnpm-lock.yaml"),
    "lockfileVersion: 1\n",
  )
  fs.copyFileSync(
    path.join(repoRoot, "pnpm-lock.yaml"),
    path.join(repoRoot, "node_modules", ".pnpm", "lock.yaml"),
  )
  fs.writeFileSync(
    path.join(fakeBin, "pnpm"),
    `#!/bin/bash
set -euo pipefail
printf '%s\\n' "$*" >> "$FAKE_PNPM_CALLS"
if [ "\${1:-}" = "exec" ]; then
  [ ! -f "$FAKE_REPO_ROOT/.missing-tsc" ]
  exit
fi
if [ "\${1:-}" = "install" ]; then
  sleep "\${FAKE_INSTALL_DELAY:-0}"
  cp "$FAKE_REPO_ROOT/pnpm-lock.yaml" "$FAKE_REPO_ROOT/node_modules/.pnpm/lock.yaml"
  rm -f "$FAKE_REPO_ROOT/.missing-tsc"
fi
`,
  )
  fs.chmodSync(path.join(fakeBin, "pnpm"), 0o755)
})

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true })
})

describe("ensure-workspace-deps", () => {
  it("skips installation when the lockfile and package commands are ready", () => {
    expect(run()).toContain("workspace dependencies ready")
    expect(fs.readFileSync(callsPath, "utf8")).not.toContain("install")
  })

  it("repairs missing package commands even when root node_modules exists", () => {
    fs.writeFileSync(path.join(repoRoot, ".missing-tsc"), "\n")

    expect(run()).toContain("running pnpm install")
    expect(fs.readFileSync(callsPath, "utf8")).toContain(
      "install --frozen-lockfile",
    )
  })

  it("installs when the workspace lockfile changed", () => {
    fs.writeFileSync(
      path.join(repoRoot, "pnpm-lock.yaml"),
      "lockfileVersion: 2\n",
    )

    expect(run()).toContain("running pnpm install")
    expect(fs.readFileSync(callsPath, "utf8")).toContain(
      "install --frozen-lockfile",
    )
  })

  it("serializes concurrent dependency repairs", async () => {
    fs.writeFileSync(path.join(repoRoot, ".missing-tsc"), "\n")

    await Promise.all([
      runAsync({ FAKE_INSTALL_DELAY: "0.5" }),
      runAsync({ FAKE_INSTALL_DELAY: "0.5" }),
    ])

    const installs = fs
      .readFileSync(callsPath, "utf8")
      .split("\n")
      .filter((line) => line === "install --frozen-lockfile")
    expect(installs).toHaveLength(1)
  })
})
