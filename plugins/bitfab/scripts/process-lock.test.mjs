import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/process-lock.sh",
)

let tmp
let lockPath
let criticalPath

function run(delay) {
  return execFileAsync(
    "bash",
    [
      "-c",
      `
set -euo pipefail
source "$PROCESS_LOCK_SCRIPT"
process_lock_acquire "$LOCK_PATH" 120 0.01
mkdir "$CRITICAL_PATH"
sleep "$DELAY"
rmdir "$CRITICAL_PATH"
process_lock_release
`,
    ],
    {
      env: {
        ...process.env,
        CRITICAL_PATH: criticalPath,
        DELAY: delay,
        LOCK_PATH: lockPath,
        PROCESS_LOCK_SCRIPT: SCRIPT,
      },
    },
  )
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "process-lock-"))
  lockPath = path.join(tmp, "test.lock")
  criticalPath = path.join(tmp, "critical")
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("process-lock", () => {
  it("serializes concurrent callers through a leftover lock file", async () => {
    fs.writeFileSync(lockPath, "leftover\n")

    await Promise.all([run("0.1"), run("0")])

    expect(fs.existsSync(criticalPath)).toBe(false)
    expect(fs.existsSync(lockPath)).toBe(true)
  })
})
