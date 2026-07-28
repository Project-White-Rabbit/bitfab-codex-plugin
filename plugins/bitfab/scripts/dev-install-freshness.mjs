#!/usr/bin/env node

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const INPUTS = [
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "scripts/vendor-bitfab-plugin.sh",
  "bitfab-flow/package.json",
  "bitfab-flow/tsconfig.json",
  "bitfab-flow/src",
  "bitfab-plugin-lib/package.json",
  "bitfab-plugin-lib/tsconfig.json",
  "bitfab-plugin-lib/scripts",
  "bitfab-plugin-lib/src",
  "bitfab-codex-plugin/.codex-plugin",
  "bitfab-codex-plugin/hooks",
  "bitfab-codex-plugin/package.json",
  "bitfab-codex-plugin/scripts",
  "bitfab-codex-plugin/skills",
  "bitfab-codex-plugin/src",
  "bitfab-codex-plugin/tsconfig.json",
  "bitfab-dev-codex-plugin/.codex-plugin",
  "bitfab-dev-codex-plugin/skills",
  "bitfab-accounts-codex-plugin/.codex-plugin",
  "bitfab-accounts-codex-plugin/mcp.json",
  "bitfab-accounts-codex-plugin/skills",
]

const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules", "tmp"])

function collectFiles(repoRoot, relativePath, files) {
  const absolutePath = path.join(repoRoot, relativePath)
  if (!fs.existsSync(absolutePath)) {
    return
  }

  const stat = fs.lstatSync(absolutePath)
  if (stat.isSymbolicLink()) {
    files.push(relativePath)
    return
  }
  if (stat.isFile()) {
    if (!relativePath.includes(".test.")) {
      files.push(relativePath)
    }
    return
  }
  if (!stat.isDirectory()) {
    return
  }

  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue
    }
    collectFiles(repoRoot, path.join(relativePath, entry.name), files)
  }
}

export function computeSourceHash(repoRoot) {
  const files = []
  for (const input of INPUTS) {
    collectFiles(repoRoot, input, files)
  }
  files.sort()

  const hash = crypto.createHash("sha256")
  for (const relativePath of files) {
    const absolutePath = path.join(repoRoot, relativePath)
    hash.update(relativePath)
    hash.update("\0")
    if (fs.lstatSync(absolutePath).isSymbolicLink()) {
      hash.update(fs.readlinkSync(absolutePath))
    } else {
      hash.update(fs.readFileSync(absolutePath))
    }
    hash.update("\0")
  }
  return hash.digest("hex")
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repoRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : process.cwd()
  process.stdout.write(`${computeSourceHash(repoRoot)}\n`)
}
