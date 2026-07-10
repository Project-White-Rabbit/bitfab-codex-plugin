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
  // A real vendored marketplace contains all internal plugins; ensure-dev only
  // enables optional plugins when their vendor directories are present.
  fs.mkdirSync(path.join(vendor, "plugins", "bitfab"), { recursive: true })
  fs.mkdirSync(path.join(vendor, "plugins", "bitfab-dev"), { recursive: true })
  fs.mkdirSync(path.join(vendor, "plugins", "bitfab-accounts"), {
    recursive: true,
  })
})

afterEach(() => {
  fs.rmSync(codexHome, { recursive: true, force: true })
  fs.rmSync(vendor, { recursive: true, force: true })
})

describe("codex-config ensure-dev (stable shim)", () => {
  it("registers the stable shim marketplace with internal plugins enabled", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain("[marketplaces.bitfab-internal]")
    expect(cfg).toContain(`source = "${vendor}"`)
    expect(cfg).toContain('[plugins."bitfab@bitfab-internal"]\nenabled = true')
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal"]\nenabled = true',
    )
    expect(cfg).toContain(
      '[plugins."bitfab-accounts@bitfab-internal"]\nenabled = true',
    )
  })

  it("disables the prod bitfab@bitfab plugin (worktrees run dev, not prod)", () => {
    fs.writeFileSync(configPath, '[plugins."bitfab@bitfab"]\nenabled = true\n')
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).toContain('[plugins."bitfab@bitfab"]\nenabled = false')
  })

  it("preserves the prod marketplace while disabling the prod plugin", () => {
    fs.writeFileSync(
      configPath,
      [
        "[marketplaces.bitfab]",
        'source = "Project-White-Rabbit/bitfab-codex-plugin"',
        "",
        '[plugins."bitfab@bitfab"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain("[marketplaces.bitfab]")
    expect(cfg).toContain('source = "Project-White-Rabbit/bitfab-codex-plugin"')
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = false')
  })

  it("preserves the stable bitfab-internal marketplace and rewrites its source", () => {
    const stableCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
    )
    fs.mkdirSync(stableCache, { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        "[marketplaces.bitfab-internal]",
        'source = "/old/source"',
        "",
        '[plugins."bitfab-dev@bitfab-internal"]',
        "enabled = false",
        "",
        '[plugins."bitfab-accounts@bitfab-internal"]',
        "enabled = false",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain("[marketplaces.bitfab-internal]")
    expect(cfg).toContain(`source = "${vendor}"`)
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal"]\nenabled = true',
    )
    expect(cfg).toContain(
      '[plugins."bitfab-accounts@bitfab-internal"]\nenabled = true',
    )
    expect(fs.existsSync(stableCache)).toBe(true)
  })

  it("migrates the legacy bitfab-dev marketplace without deleting its cache", () => {
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
        '[plugins."bitfab-accounts@bitfab-dev"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).not.toContain("[marketplaces.bitfab-dev]")
    expect(cfg).not.toContain('"bitfab@bitfab-dev"')
    // The orphan dev plugin block must go too, not be left pointing at a
    // marketplace that no longer exists.
    expect(cfg).not.toContain('"bitfab-dev@bitfab-dev"')
    expect(cfg).not.toContain('"bitfab-accounts@bitfab-dev"')
    expect(fs.existsSync(legacyCache)).toBe(true)
  })

  it("prunes a marketplace whose worktree source dir is gone without deleting its cache", () => {
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
        '[plugins."bitfab-accounts@bitfab-internal-dead"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).not.toContain("bitfab-internal-dead")
    expect(fs.existsSync(deadCache)).toBe(true)
  })

  it("prunes an orphan internal plugin block even after its marketplace block is gone", () => {
    const orphanCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal-orphan",
    )
    fs.mkdirSync(orphanCache, { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        '[plugins."bitfab@bitfab-internal-orphan"]',
        "enabled = true",
        "",
        '[plugins."bitfab-dev@bitfab-internal-orphan"]',
        "enabled = true",
        "",
        '[plugins."bitfab-accounts@bitfab-internal-orphan"]',
        "enabled = true",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).not.toContain("bitfab-internal-orphan")
    expect(fs.existsSync(orphanCache)).toBe(true)
  })

  it("prunes nested plugin config for an orphan internal marketplace", () => {
    const orphanCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal-nested",
    )
    fs.mkdirSync(orphanCache, { recursive: true })
    fs.writeFileSync(
      configPath,
      [
        '[plugins."bitfab@bitfab-internal-nested".mcp_servers.Bitfab.tools.get_bitfab_api_key]',
        "enabled = false",
        "",
        '[plugins."bitfab-accounts@bitfab-internal-nested".mcp_servers.notion.tools.notion-search]',
        "enabled = false",
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).not.toContain("bitfab-internal-nested")
    expect(fs.existsSync(orphanCache)).toBe(true)
  })

  it("leaves cache-only internal directories alone for running sessions", () => {
    const cacheOnly = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal-cache-only",
    )
    fs.mkdirSync(path.join(cacheOnly, "bitfab-dev", "local"), {
      recursive: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).not.toContain("bitfab-internal-cache-only")
    expect(fs.existsSync(cacheOnly)).toBe(true)
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
          '[plugins."bitfab-accounts@bitfab-internal-wt-b"]',
          "enabled = true",
          "",
          '[hooks.state."bitfab@bitfab-internal-wt-b:hooks/hooks.json:session_start:0:0"]',
          'trusted_hash = "sha256:test"',
          "",
          '[hooks.state."bitfab-accounts@bitfab-internal-wt-b:hooks/hooks.json:session_start:0:0"]',
          'trusted_hash = "sha256:accounts"',
          "",
        ].join("\n"),
      )
      run("ensure-dev", configPath, vendor, "bitfab-internal")
      const cfg = readConfig()
      expect(cfg).not.toContain("[marketplaces.bitfab-internal-wt-b]")
      expect(cfg).not.toContain("bitfab-dev@bitfab-internal-wt-b")
      expect(cfg).not.toContain("bitfab-accounts@bitfab-internal-wt-b")
      expect(cfg).not.toContain("bitfab@bitfab-internal-wt-b:hooks")
      expect(cfg).not.toContain("bitfab-accounts@bitfab-internal-wt-b:hooks")
      expect(fs.existsSync(siblingCache)).toBe(true)
      // current worktree active
      expect(cfg).toContain(
        '[plugins."bitfab-dev@bitfab-internal"]\nenabled = true',
      )
      expect(cfg).toContain(
        '[plugins."bitfab-accounts@bitfab-internal"]\nenabled = true',
      )
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true })
    }
  })

  it("prunes stale internal hook state even after the marketplace block is gone", () => {
    fs.writeFileSync(
      configPath,
      [
        '[hooks.state."bitfab@bitfab-internal:hooks/hooks.json:session_start:0:0"]',
        'trusted_hash = "sha256:current"',
        "",
        '[hooks.state."bitfab@bitfab-internal-wt-b:hooks/hooks.json:session_start:0:0"]',
        'trusted_hash = "sha256:test"',
        "",
        '[hooks.state."bitfab-accounts@bitfab-internal-wt-b:hooks/hooks.json:session_start:0:0"]',
        'trusted_hash = "sha256:accounts"',
        "",
      ].join("\n"),
    )
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain("bitfab@bitfab-internal:hooks")
    expect(cfg).not.toContain("bitfab-internal-wt-b")
  })

  it("is idempotent: a second run produces identical output", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const first = readConfig()
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).toBe(first)
  })

  it("preserves current and sibling caches while pruning sibling config", () => {
    const currentCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal",
    )
    const siblingCache = path.join(
      codexHome,
      "plugins",
      "cache",
      "bitfab-internal-wt-b",
    )
    fs.mkdirSync(path.join(currentCache, "bitfab", "local"), {
      recursive: true,
    })
    fs.mkdirSync(path.join(siblingCache, "bitfab", "local"), {
      recursive: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(fs.existsSync(currentCache)).toBe(true)
    expect(fs.existsSync(siblingCache)).toBe(true)
  })

  it("leaves bitfab-dev uninstalled (no enabled block) when it was not vendored", () => {
    // Simulate install-dev.sh's skip branch: marketplace has bitfab but not
    // bitfab-dev. Enabling a plugin Codex can't find would fail plugin load.
    fs.rmSync(path.join(vendor, "plugins", "bitfab-dev"), {
      recursive: true,
      force: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain('[plugins."bitfab@bitfab-internal"]\nenabled = true')
    expect(cfg).not.toContain("bitfab-dev@bitfab-internal")
  })

  it("leaves bitfab-accounts uninstalled (no enabled block) when it was not vendored", () => {
    fs.rmSync(path.join(vendor, "plugins", "bitfab-accounts"), {
      recursive: true,
      force: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain('[plugins."bitfab@bitfab-internal"]\nenabled = true')
    expect(cfg).not.toContain("bitfab-accounts@bitfab-internal")
  })

  it("drops a previously-enabled bitfab-dev block once it is no longer vendored", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).toContain(
      '[plugins."bitfab-dev@bitfab-internal"]\nenabled = true',
    )
    // Next reconcile runs against a vendor that no longer has bitfab-dev.
    fs.rmSync(path.join(vendor, "plugins", "bitfab-dev"), {
      recursive: true,
      force: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).not.toContain("bitfab-dev@bitfab-internal")
  })

  it("drops a previously-enabled bitfab-accounts block once it is no longer vendored", () => {
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).toContain(
      '[plugins."bitfab-accounts@bitfab-internal"]\nenabled = true',
    )
    fs.rmSync(path.join(vendor, "plugins", "bitfab-accounts"), {
      recursive: true,
      force: true,
    })
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).not.toContain("bitfab-accounts@bitfab-internal")
  })
})

describe("codex-config toggle (stable shim)", () => {
  beforeEach(() => {
    run("ensure-dev", configPath, vendor, "bitfab-internal")
  })

  it("dev enables the stable shim bitfab and disables prod", () => {
    run("toggle", configPath, "dev", "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain('[plugins."bitfab@bitfab-internal"]\nenabled = true')
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = false')
  })

  it("prod disables the stable shim bitfab and enables prod, leaving helper plugins on", () => {
    run("toggle", configPath, "prod", "bitfab-internal")
    const cfg = readConfig()
    expect(cfg).toContain('[plugins."bitfab@bitfab-internal"]\nenabled = false')
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = true')
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal"]\nenabled = true',
    )
    expect(cfg).toContain(
      '[plugins."bitfab-accounts@bitfab-internal"]\nenabled = true',
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
    run("ensure-dev", configPath, vendor, "bitfab-internal")
    expect(readConfig()).toContain('[plugins."bitfab@bitfab"]\nenabled = false')

    run("restore-prod", configPath)
    const cfg = readConfig()
    expect(cfg).toContain('[plugins."bitfab@bitfab"]\nenabled = true')
    expect(cfg).toContain('[plugins."bitfab@bitfab-internal"]\nenabled = false')
    expect(cfg).toContain(
      '[plugins."bitfab-dev@bitfab-internal"]\nenabled = false',
    )
    expect(cfg).toContain(
      '[plugins."bitfab-accounts@bitfab-internal"]\nenabled = false',
    )
  })
})
