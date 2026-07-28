import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { computeSourceHash } from "./dev-install-freshness.mjs"

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
)
const INSTALL_SCRIPT = path.join(
  REPO_ROOT,
  "bitfab-codex-plugin",
  "scripts",
  "install-dev.sh",
)

let repoRoot

function prepareCompleteInstall(codexHome) {
  const sourceHash = computeSourceHash(REPO_ROOT)
  const stableVendor = path.join(codexHome, "bitfab", "internal-marketplace")
  for (const output of [
    path.join(stableVendor, ".agents", "plugins", "marketplace.json"),
    path.join(
      stableVendor,
      "plugins",
      "bitfab",
      ".codex-plugin",
      "plugin.json",
    ),
    path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
      "bitfab",
      "local",
      ".codex-plugin",
      "plugin.json",
    ),
    path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
      "bitfab",
      "local",
      "dist",
      "commands",
      "status.js",
    ),
    path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
      "bitfab-dev",
      "local",
      ".codex-plugin",
      "plugin.json",
    ),
    path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
      "bitfab-accounts",
      "local",
      ".codex-plugin",
      "plugin.json",
    ),
    path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
      "bitfab-accounts",
      "local",
      "mcp.json",
    ),
  ]) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, "{}\n")
  }
  fs.writeFileSync(path.join(stableVendor, ".source-hash"), `${sourceHash}\n`)
  return stableVendor
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dev-install-freshness-"))
  fs.mkdirSync(path.join(repoRoot, "bitfab-flow", "src"), { recursive: true })
  fs.mkdirSync(path.join(repoRoot, "bitfab-codex-plugin", "src"), {
    recursive: true,
  })
  fs.writeFileSync(
    path.join(repoRoot, "bitfab-flow", "src", "index.ts"),
    "export const flow = 1\n",
  )
  fs.writeFileSync(
    path.join(repoRoot, "bitfab-codex-plugin", "src", "index.ts"),
    "export const plugin = 1\n",
  )
})

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true })
})

describe("dev install freshness", () => {
  it("is stable when build inputs are unchanged", () => {
    expect(computeSourceHash(repoRoot)).toBe(computeSourceHash(repoRoot))
  })

  it("changes for shared library and plugin source edits", () => {
    const initial = computeSourceHash(repoRoot)
    fs.writeFileSync(
      path.join(repoRoot, "bitfab-flow", "src", "index.ts"),
      "export const flow = 2\n",
    )
    const sharedChange = computeSourceHash(repoRoot)
    fs.writeFileSync(
      path.join(repoRoot, "bitfab-codex-plugin", "src", "index.ts"),
      "export const plugin = 2\n",
    )

    expect(sharedChange).not.toBe(initial)
    expect(computeSourceHash(repoRoot)).not.toBe(sharedChange)
  })

  it("ignores build outputs, dependencies, and tests", () => {
    const initial = computeSourceHash(repoRoot)
    fs.mkdirSync(path.join(repoRoot, "bitfab-flow", "dist"), {
      recursive: true,
    })
    fs.mkdirSync(path.join(repoRoot, "bitfab-flow", "node_modules"), {
      recursive: true,
    })
    fs.writeFileSync(
      path.join(repoRoot, "bitfab-flow", "dist", "index.js"),
      "compiled\n",
    )
    fs.writeFileSync(
      path.join(repoRoot, "bitfab-flow", "node_modules", "dependency.js"),
      "dependency\n",
    )
    fs.writeFileSync(
      path.join(repoRoot, "bitfab-flow", "src", "index.test.ts"),
      "test\n",
    )

    expect(computeSourceHash(repoRoot)).toBe(initial)
  })

  it("lets install-dev skip a complete install with a matching hash", () => {
    const codexHome = path.join(repoRoot, "codex-home")
    prepareCompleteInstall(codexHome)

    const output = execFileSync("bash", [INSTALL_SCRIPT, "--if-stale"], {
      env: { ...process.env, CODEX_HOME: codexHome },
    }).toString()

    expect(output).toContain("build inputs unchanged, skipping rebuild")
  })

  it("does not trust the success stamp when an essential output is missing", () => {
    const codexHome = path.join(repoRoot, "codex-home")
    const stableVendor = prepareCompleteInstall(codexHome)
    fs.rmSync(
      path.join(
        codexHome,
        "plugins",
        "cache",
        "bitfab-internal",
        "bitfab",
        "local",
        "dist",
        "commands",
        "status.js",
      ),
    )
    const fakeBin = path.join(repoRoot, "failing-bin")
    fs.mkdirSync(fakeBin)
    fs.writeFileSync(path.join(fakeBin, "pnpm"), "#!/bin/bash\nexit 42\n")
    fs.chmodSync(path.join(fakeBin, "pnpm"), 0o755)

    expect(() =>
      execFileSync("bash", [INSTALL_SCRIPT, "--if-stale"], {
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
          PATH: `${fakeBin}:${process.env.PATH}`,
        },
      }),
    ).toThrow()
    expect(fs.existsSync(path.join(stableVendor, ".source-hash"))).toBe(false)
  })

  it("reuses a leftover unlocked install lock file", () => {
    const codexHome = path.join(repoRoot, "codex-home")
    prepareCompleteInstall(codexHome)
    const lockPath = path.join(codexHome, "bitfab", "install-dev.lock")
    fs.writeFileSync(lockPath, "leftover\n")

    const output = execFileSync("bash", [INSTALL_SCRIPT, "--if-stale"], {
      env: { ...process.env, CODEX_HOME: codexHome },
    }).toString()

    expect(output).toContain("build inputs unchanged, skipping rebuild")
    expect(fs.existsSync(lockPath)).toBe(true)
  })
})
