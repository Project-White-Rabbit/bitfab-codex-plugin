import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_VERSION = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../package.json"),
    "utf-8",
  ),
).version as string

export function getVersion(): string {
  return PLUGIN_VERSION
}
