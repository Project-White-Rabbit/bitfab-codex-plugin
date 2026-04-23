#!/usr/bin/env node
/**
 * Idempotent editor for ~/.codex/config.toml.
 *
 * Codex has no `plugin enable/disable` CLI, so the dev-build and toggle
 * skills need to rewrite TOML in place. The patterns we manage are narrow
 * (two plugin blocks and one local marketplace), so we use regex-based
 * surgical edits rather than a full TOML parser.
 *
 * Usage:
 *   codex-config.mjs ensure-dev <configPath> <vendorPath>
 *   codex-config.mjs toggle     <configPath> <dev|prod>
 */

import fs from "node:fs"
import path from "node:path"

const [, , cmd, configPath, arg] = process.argv

function usage() {
  console.error("Usage: codex-config.mjs ensure-dev <configPath> <vendorPath>")
  console.error("       codex-config.mjs toggle     <configPath> <dev|prod>")
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
  const ending = content.endsWith("\n") ? content : `${content}\n`
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

function ensureDev(vendorPath) {
  if (!vendorPath) {
    usage()
  }
  const absVendor = path.resolve(vendorPath)
  let content = readConfig()
  content = setKey(
    content,
    "[marketplaces.bitfab-dev]",
    "source_type",
    quote("local"),
  )
  content = setKey(
    content,
    "[marketplaces.bitfab-dev]",
    "source",
    quote(absVendor),
  )
  content = setKey(
    content,
    '[plugins."bitfab@bitfab-dev"]',
    "enabled",
    "false",
    { onlyIfMissing: true },
  )
  writeConfig(content)
  console.log(`[codex-config] marketplaces.bitfab-dev.source = ${absVendor}`)
  console.log(`[codex-config] plugins."bitfab@bitfab-dev" block ensured`)
}

function toggle(variant) {
  if (variant !== "dev" && variant !== "prod") {
    usage()
  }
  const devEnabled = variant === "dev" ? "true" : "false"
  const prodEnabled = variant === "prod" ? "true" : "false"
  let content = readConfig()
  content = setKey(
    content,
    '[plugins."bitfab@bitfab-dev"]',
    "enabled",
    devEnabled,
  )
  content = setKey(content, '[plugins."bitfab@bitfab"]', "enabled", prodEnabled)
  writeConfig(content)
  console.log(
    `[codex-config] plugins."bitfab@bitfab-dev".enabled = ${devEnabled}`,
  )
  console.log(`[codex-config] plugins."bitfab@bitfab".enabled = ${prodEnabled}`)
}

if (cmd === "ensure-dev") {
  ensureDev(arg)
} else if (cmd === "toggle") {
  toggle(arg)
} else {
  usage()
}
