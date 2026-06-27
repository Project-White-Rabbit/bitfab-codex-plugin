import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "codex-config.mjs",
)

let codexHome
let configPath
let vendor

function run(...args) {
  execFileSync("node", [SCRIPT, ...args], { stdio: "pipe" })
}

function readConfig() {
  return fs.readFileSync(configPath, "utf8")
}

beforeEach(() => {
  codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cfg-"))
  configPath = path.join(codexHome, "config.toml")
  fs.mkdirSync(path.join(codexHome, "plugins", "cache"), { recursive: true })
  vendor = fs.mkdtempSync(path.join(os.tmpdir(), "vendor-"))
  // A real vendored marketplace contains both plugins; ensure-dev only enables
  // bitfab-dev when plugins/bitfab-dev is present in the source.
  fs.mkdirSync(path.join(vendor, "plugins", "bitfab"), { recursive: true })
  fs.mkdirSync(path.join(vendor, "plugins", "bitfab-dev"), { recursive: true })
})

afterEach(() => {
  fs.rmSync(codexHome, { recursive: true, force: true })
  fs.rmSync(vendor, { recursive: true, force: true })
})

describe("codex-config ensure-dev (per-worktree)", () => {
  it("registers the worktree marketplace with dev bitfab + bitfab-dev enabled", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).toContain("[marketplaces.bitfab-internal-wt-a]")
    expect(cfg).toContain(`source = "${vendor}"`)
    expect(cfg).toContain(
      '[plugins."bitfab@bitfab-internal-wt-a"]\nenabled = true',
    )
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal-wt-a"]\nenabled = true',
    )
  })

  it("disables the prod bitfab@bitfab plugin (worktrees run dev, not prod)", () => {
    fs.writeFileSync(configPath, '[plugins."bitfab@bitfab"]\nenabled = true\n')
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    expect(readConfig()).toContain('[plugins."bitfab@bitfab"]\nenabled = false')
  })

  it("migrates the legacy singleton bitfab-internal and removes its cache", () => {
    const legacyCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
    )
    fs.mkdirSync(legacyCache, { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        "[marketplaces.bitfab-internal]",
        `source = "${vendor}"`,
        "",
        '[plugins."bitfab-dev@bitfab-internal"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).not.toContain("[marketplaces.bitfab-internal]")
    expect(cfg).not.toContain('"bitfab-dev@bitfab-internal"')
    expect(fs.existsSync(legacyCache)).toBe(false)
  })

  it("migrates the legacy bitfab-dev marketplace, removing both plugin blocks and its cache", () => {
    const legacyCache = path.join(codexHome, "plugins", "cache", "bitfab-dev")
    fs.mkdirSync(legacyCache, { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        "[marketplaces.bitfab-dev]",
        `source = "${vendor}"`,
        "",
        '[plugins."bitfab@bitfab-dev"]',
        "enabled = true",
        "",
        '[plugins."bitfab-dev@bitfab-dev"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).not.toContain("[marketplaces.bitfab-dev]")
    expect(cfg).not.toContain('"bitfab@bitfab-dev"')
    // The orphan dev plugin block must go too, not be left pointing at a
    // marketplace that no longer exists.
    expect(cfg).not.toContain('"bitfab-dev@bitfab-dev"')
    expect(fs.existsSync(legacyCache)).toBe(false)
  })

  it("prunes a marketplace whose worktree source dir is gone, including its cache", () => {
    const deadCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal-dead",
    )
    fs.mkdirSync(deadCache, { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        "[marketplaces.bitfab-internal-dead]",
        'source = "/no/such/worktree/path"',
        "",
        '[plugins."bitfab-dev@bitfab-internal-dead"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).not.toContain("bitfab-internal-dead")
    expect(fs.existsSync(deadCache)).toBe(false)
  })

  it("prunes a still-live sibling worktree's marketplace so skills never collide", () => {
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "sibling-"))
    const siblingCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal-wt-b",
    )
    try {
      fs.mkdirSync(siblingCache, { recursive: true })
      fs.writeFileSync(
        configPath,
        [
          "[marketplaces.bitfab-internal-wt-b]",
          `source = "${sibling}"`,
          "",
          '[plugins."bitfab-dev@bitfab-internal-wt-b"]',
          "enabled = true",
          "",
          '[hooks.state."bitfab@bitfab-internal-wt-b:hooks/hooks.json:session_start:0:0"]',
          'trusted_hash = "sha256:test"',
          "",
        ].join("\n"),
      )
      run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
      const cfg = readConfig()
      expect(cfg).not.toContain("[marketplaces.bitfab-internal-wt-b]")
      expect(cfg).not.toContain("bitfab-dev@bitfab-internal-wt-b")
      expect(cfg).not.toContain("bitfab@bitfab-internal-wt-b:hooks")
      expect(fs.existsSync(siblingCache)).toBe(false)
      // current worktree active
      expect(cfg).toContain(
        '[plugins."bitfab-dev@bitfab-internal-wt-a"]\nenabled = true',
      )
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true })
    }
  })

  it("prunes stale internal hook state even after the marketplace block is gone", () => {
    fs.writeFileSync(
      configPath,
      [
        '[hooks.state."bitfab@bitfab-internal-wt-a:hooks/hooks.json:session_start:0:0"]',
        'trusted_hash = "sha256:current"',
        "",
        '[hooks.state."bitfab@bitfab-internal-wt-b:hooks/hooks.json:session_start:0:0"]',
        'trusted_hash = "sha256:test"',
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).toContain("bitfab@bitfab-internal-wt-a:hooks")
    expect(cfg).not.toContain("bitfab-internal-wt-b")
  })

  it("is idempotent: a second run produces identical output", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const first = readConfig()
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    expect(readConfig()).toBe(first)
  })

  it("leaves bitfab-dev uninstalled (no enabled block) when it was not vendored", () => {
    // Simulate install-dev.sh's skip branch: marketplace has bitfab but not
    // bitfab-dev. Enabling a plugin Codex can't find would fail plugin load.
    fs.rmSync(path.join(vendor, "plugins", "bitfab-dev"), {
      recursive: true,
      force: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).toContain(
      '[plugins."bitfab@bitfab-internal-wt-a"]\nenabled = true',
    )
    expect(cfg).not.toContain("bitfab-dev@bitfab-internal-wt-a")
  })

  it("drops a previously-enabled bitfab-dev block once it is no longer vendored", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    expect(readConfig()).toContain(
      '[plugins."bitfab-dev@bitfab-internal-wt-a"]\nenabled = true',
    )
    // Next reconcile runs against a vendor that no longer has bitfab-dev.
    fs.rmSync(path.join(vendor, "plugins", "bitfab-dev"), {
      recursive: true,
      force: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    expect(readConfig()).not.toContain("bitfab-dev@bitfab-internal-wt-a")
  })
})

describe("codex-config toggle (per-worktree)", () => {
  beforeEach(() => {
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
  })

  it("dev enables the worktree's bitfab and disables prod", () => {
    run("toggle", configPath, "dev", "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).toContain(
      '[plugins."bitfab@bitfab-internal-wt-a"]\nenabled = true',
    )
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = false')
  })

  it("prod disables the worktree's bitfab and enables prod, leaving bitfab-dev on", () => {
    run("toggle", configPath, "prod", "bitfab-internal-wt-a")
    const cfg = readConfig()
    expect(cfg).toContain(
      '[plugins."bitfab@bitfab-internal-wt-a"]\nenabled = false',
    )
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = true')
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal-wt-a"]\nenabled = true',
    )
  })
})

describe("codex-config ensure-trust", () => {
  it("marks a worktree folder trusted (bypassPermissions analog)", () => {
    fs.writeFileSync(configPath, '[plugins."bitfab@bitfab"]\nenabled = true\n')
    run("ensure-trust", configPath, "/work/tree/cooked-cave")
    const cfg = readConfig()
    expect(cfg).toContain('[projects."/work/tree/cooked-cave"]')
    expect(cfg).toContain('trust_level = "trusted"')
    // leaves unrelated config intact
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = true')
  })

  it("is idempotent", () => {
    run("ensure-trust", configPath, "/work/tree/cooked-cave")
    const first = readConfig()
    run("ensure-trust", configPath, "/work/tree/cooked-cave")
    expect(readConfig()).toBe(first)
  })
})

describe("codex-config restore-prod (main repo)", () => {
  it("enables prod and disables every internal/dev plugin a worktree left on", () => {
    // Simulate the global state after a worktree session: dev on, prod off.
    run("ensure-dev", configPath, vendor, "bitfab-internal-wt-a")
    expect(readConfig()).toContain('[plugins."bitfab@bitfab"]\nenabled = false')

    run("restore-prod", configPath)
    const cfg = readConfig()
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = true')
    expect(cfg).toContain(
      '[plugins."bitfab@bitfab-internal-wt-a"]\nenabled = false',
    )
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal-wt-a"]\nenabled = false',
    )
  })
})
