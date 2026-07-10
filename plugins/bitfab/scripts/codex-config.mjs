#!/usr/bin/env node
/**
 * Idempotent editor for ~/.codex/config.toml.
 *
 * Codex has no `plugin enable/disable` CLI, so the dev-build and toggle
 * skills need to rewrite TOML in place. We use regex-based surgical edits
 * rather than a full TOML parser.
 *
 * Worktree isolation: Codex's config.toml is global with no project scoping,
 * so we register one stable `bitfab-internal` shim marketplace and route that
 * shim through a session-scoped worktree runtime map. Session start keeps the
 * stable marketplace enabled and prunes old per-worktree `bitfab-internal-*`
 * config entries. We leave sibling caches on disk because concurrently running
 * Codex sessions may still hold in-memory skill metadata that points at them.
 *
 * Usage:
 *   codex-config.mjs ensure-dev <configPath> <vendorPath> <marketplaceName>
 *   codex-config.mjs toggle     <configPath> <dev|prod>   <marketplaceName>
 */

import fs from "node:fs"
import path from "node:path"

const [, , cmd, configPath, arg, arg2] = process.argv
const INTERNAL_PLUGINS = ["bitfab", "bitfab-dev", "bitfab-accounts"]
const OPTIONAL_INTERNAL_PLUGINS = ["bitfab-dev", "bitfab-accounts"]

function usage() {
  console.error(
    "Usage: codex-config.mjs ensure-dev <configPath> <vendorPath> <marketplaceName>",
  )
  console.error(
    "       codex-config.mjs toggle     <configPath> <dev|prod>   <marketplaceName>",
  )
  console.error("       codex-config.mjs restore-prod  <configPath>")
  console.error(
    "       codex-config.mjs ensure-trust  <configPath> <projectPath>",
  )
  process.exit(2)
}

if (!cmd || !configPath) {
  usage()
}

function readConfig() {
  if (!fs.existsSync(configPath)) {
    return ""
  }
  return fs.readFileSync(configPath, "utf8")
}

function writeConfig(content) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  // Collapse the blank-line gaps left when sections are removed.
  const tidy = content.replace(/\n{3,}/g, "\n\n")
  const ending = tidy.endsWith("\n") ? tidy : `${tidy}\n`
  fs.writeFileSync(configPath, ending)
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function locateSection(lines, header) {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) {
      start = i
      break
    }
  }
  if (start === -1) {
    return null
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[.+\]\s*$/.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, end }
}

function setKey(content, header, key, value, opts = {}) {
  const onlyIfMissing = opts.onlyIfMissing === true
  const lines = content.length ? content.split("\n") : []
  const section = locateSection(lines, header)
  const rendered = `${key} = ${value}`
  const keyRe = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`)

  if (!section) {
    if (lines.length && lines[lines.length - 1].trim() !== "") {
      lines.push("")
    }
    lines.push(header)
    lines.push(rendered)
    return `${lines.join("\n").replace(/\n*$/, "")}\n`
  }

  for (let i = section.start + 1; i < section.end; i++) {
    if (keyRe.test(lines[i])) {
      if (!onlyIfMissing) {
        lines[i] = rendered
      }
      return `${lines.join("\n").replace(/\n*$/, "")}\n`
    }
  }

  let insertAt = section.end
  while (insertAt > section.start + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--
  }
  lines.splice(insertAt, 0, rendered)
  return `${lines.join("\n").replace(/\n*$/, "")}\n`
}

function quote(s) {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

function removeSection(content, header) {
  if (!content.length) {
    return content
  }
  const lines = content.split("\n")
  const section = locateSection(lines, header)
  if (!section) {
    return content
  }
  let end = section.end
  while (end > section.start && lines[end - 1].trim() === "") {
    end--
  }
  lines.splice(section.start, end - section.start)
  while (lines.length && lines[lines.length - 1].trim() === "") {
    lines.pop()
  }
  return lines.length ? `${lines.join("\n")}\n` : ""
}

function removeSectionsMatching(content, shouldRemove) {
  if (!content.length) {
    return content
  }
  const lines = content.split("\n")
  const kept = []
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (/^\s*\[.+\]\s*$/.test(line) && shouldRemove(line.trim())) {
      i++
      while (i < lines.length && !/^\s*\[.+\]\s*$/.test(lines[i])) {
        i++
      }
      continue
    }
    kept.push(line)
    i++
  }
  while (kept.length && kept[kept.length - 1].trim() === "") {
    kept.pop()
  }
  return kept.length ? `${kept.join("\n")}\n` : ""
}

/**
 * Every internal dev marketplace name currently in the config: the stable
 * `bitfab-internal` shim plus old `bitfab-internal-<basename>` per-worktree
 * names. The prod `bitfab` marketplace is deliberately excluded.
 */
function listInternalMarketplaces(content) {
  const names = new Set()
  for (const line of content.split("\n")) {
    const m = line.match(/^\[marketplaces\.(bitfab-internal(?:-.+)?)\]\s*$/)
    if (m) {
      names.add(m[1])
    }
  }
  return [...names]
}

function listInternalHookStateMarketplaces(content) {
  const names = new Set()
  for (const line of content.split("\n")) {
    const m = line.match(
      /^\[hooks\.state\."(?:bitfab|bitfab-dev|bitfab-accounts)@(bitfab-internal(?:-[^:"]+)?):/,
    )
    if (m) {
      names.add(m[1])
    }
  }
  return [...names]
}

function listInternalPluginMarketplaces(content) {
  const names = new Set()
  for (const line of content.split("\n")) {
    const m = line.match(
      /^\[plugins\."(?:bitfab|bitfab-dev|bitfab-accounts)@(bitfab-internal(?:-[^"]+)?)"(?:\.|\])/,
    )
    if (m) {
      names.add(m[1])
    }
  }
  return [...names]
}

/** Remove a marketplace and its internal plugin config. */
function dropMarketplace(content, mktName) {
  let next = removeSection(content, `[marketplaces.${mktName}]`)
  const pluginRe = new RegExp(
    `^\\[plugins\\."(?:bitfab|bitfab-dev|bitfab-accounts)@${escapeRegex(mktName)}"(?:\\.|\\])`,
  )
  next = removeSectionsMatching(next, (header) => pluginRe.test(header))
  const hookStateRe = new RegExp(
    `^\\[hooks\\.state\\."(?:bitfab|bitfab-dev|bitfab-accounts)@${escapeRegex(mktName)}:`,
  )
  next = removeSectionsMatching(next, (header) => hookStateRe.test(header))
  return next
}

function ensureDev(vendorPath, mktName) {
  if (!vendorPath || !mktName) {
    usage()
  }
  const absVendor = path.resolve(vendorPath)
  let content = readConfig()

  // 1. Migrate the legacy `bitfab-dev` marketplace. If callers still use an
  //    old per-worktree marketplace name, also remove the singleton
  //    `bitfab-internal`; the stable shim path passes `bitfab-internal` and
  //    preserves it.
  content = dropMarketplace(content, "bitfab-dev")
  if (mktName !== "bitfab-internal") {
    content = dropMarketplace(content, "bitfab-internal")
  }

  // 2. Prune old per-worktree marketplaces from config. Do not delete sibling
  //    caches here: a concurrently running Codex session may still hold
  //    in-memory skill metadata pointing at that cache.
  const staleNames = new Set([
    ...listInternalMarketplaces(content),
    ...listInternalPluginMarketplaces(content),
    ...listInternalHookStateMarketplaces(content),
  ])
  for (const name of staleNames) {
    if (name === mktName) {
      continue
    }
    content = dropMarketplace(content, name)
    console.log(`[codex-config] pruned sibling marketplace ${name}`)
  }

  // 3. Register the stable shim marketplace + plugins.
  content = setKey(
    content,
    `[marketplaces.${mktName}]`,
    "source_type",
    quote("local"),
  )
  content = setKey(
    content,
    `[marketplaces.${mktName}]`,
    "source",
    quote(absVendor),
  )
  // A worktree must run the dev shim, not prod: enable bitfab and the vendored
  // internal helper plugins on
  // the stable internal marketplace and disable the prod bitfab marketplace.
  // Codex's config is global, so this flips prod off for every session until a
  // main-repo session calls `restore-prod` (see the SessionStart hook). The
  // dev/prod `toggle` command can still override.
  content = setKey(content, `[plugins."bitfab@${mktName}"]`, "enabled", "true")
  const optionalPluginStatus = new Map()
  for (const plugin of OPTIONAL_INTERNAL_PLUGINS) {
    const vendored = fs.existsSync(path.join(absVendor, "plugins", plugin))
    optionalPluginStatus.set(plugin, vendored)
    if (vendored) {
      content = setKey(
        content,
        `[plugins."${plugin}@${mktName}"]`,
        "enabled",
        "true",
      )
    } else {
      content = removeSection(content, `[plugins."${plugin}@${mktName}"]`)
    }
  }
  content = setKey(content, '[plugins."bitfab@bitfab"]', "enabled", "false")

  writeConfig(content)
  console.log(`[codex-config] marketplaces.${mktName}.source = ${absVendor}`)
  console.log(`[codex-config] plugins."bitfab@${mktName}".enabled = true`)
  for (const [plugin, vendored] of optionalPluginStatus) {
    console.log(
      vendored
        ? `[codex-config] plugins."${plugin}@${mktName}".enabled = true`
        : `[codex-config] ${plugin} not vendored; left uninstalled`,
    )
  }
  console.log(
    `[codex-config] plugins."bitfab@bitfab".enabled = false (prod off)`,
  )
}

/**
 * Main-repo state: prod bitfab on, every internal/dev plugin off. Invoked by the
 * SessionStart hook when a Codex session starts in this repo's main checkout, to
 * undo the global prod-off that a prior worktree session set.
 */
function restoreProd() {
  let content = readConfig()
  for (const name of listInternalMarketplaces(content)) {
    for (const plugin of INTERNAL_PLUGINS) {
      const header = `[plugins."${plugin}@${name}"]`
      if (locateSection(content.split("\n"), header)) {
        content = setKey(content, header, "enabled", "false")
      }
    }
  }
  content = setKey(content, '[plugins."bitfab@bitfab"]', "enabled", "true")
  writeConfig(content)
  console.log(
    `[codex-config] restored prod: plugins."bitfab@bitfab".enabled = true`,
  )
  console.log(`[codex-config] disabled all internal/dev plugins`)
}

function toggle(variant, mktName) {
  if ((variant !== "dev" && variant !== "prod") || !mktName) {
    usage()
  }
  const devEnabled = variant === "dev" ? "true" : "false"
  const prodEnabled = variant === "prod" ? "true" : "false"
  let content = readConfig()
  content = setKey(
    content,
    `[plugins."bitfab@${mktName}"]`,
    "enabled",
    devEnabled,
  )
  content = setKey(content, '[plugins."bitfab@bitfab"]', "enabled", prodEnabled)
  writeConfig(content)
  console.log(
    `[codex-config] plugins."bitfab@${mktName}".enabled = ${devEnabled}`,
  )
  console.log(`[codex-config] plugins."bitfab@bitfab".enabled = ${prodEnabled}`)
}

/**
 * Mark a worktree folder as trusted so Codex runs without per-session approval
 * prompts: the Codex analog of Claude's `permissions.defaultMode = bypassPermissions`.
 * Worktree-scoped only; never touches the main checkout (Codex trusts it already).
 */
function ensureTrust(projectPath) {
  if (!projectPath) {
    usage()
  }
  let content = readConfig()
  content = setKey(
    content,
    `[projects."${projectPath}"]`,
    "trust_level",
    quote("trusted"),
  )
  writeConfig(content)
  console.log(`[codex-config] projects."${projectPath}".trust_level = trusted`)
}

if (cmd === "ensure-dev") {
  ensureDev(arg, arg2)
} else if (cmd === "toggle") {
  toggle(arg, arg2)
} else if (cmd === "restore-prod") {
  restoreProd()
} else if (cmd === "ensure-trust") {
  ensureTrust(arg)
} else {
  usage()
}
