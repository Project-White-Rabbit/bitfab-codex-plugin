import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../scripts/with-local-test-lock.sh",
)

let tmp
let lockPath
const children = new Set()

function localTestEnv(overrides = {}) {
  return {
    ...process.env,
    BITFAB_LOCAL_TEST_LOCK_HELD: "",
    BITFAB_LOCAL_TEST_WORKERS: "",
    BITFAB_LOCAL_TEST_MAX_WORKERS: "",
    VITEST_MAX_WORKERS: "",
    CI: "",
    ...overrides,
  }
}

function spawnLocked(source) {
  const child = spawn("bash", [SCRIPT, process.execPath, "-e", source], {
    env: localTestEnv({
      BITFAB_LOCAL_TEST_LOCK_MAX_ATTEMPTS: "40",
      BITFAB_LOCAL_TEST_LOCK_PATH: lockPath,
      BITFAB_LOCAL_TEST_CPU_COUNT: "12",
    }),
    stdio: ["pipe", "pipe", "pipe"],
  })
  children.add(child)
  child.once("exit", () => children.delete(child))
  return child
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`child exited with code ${code}`))
      }
    })
  })
}

function waitForText(stream, expected) {
  return new Promise((resolve, reject) => {
    let output = ""
    stream.on("data", (chunk) => {
      output += chunk.toString()
      if (output.includes(expected)) {
        resolve(output)
      }
    })
    stream.once("error", reject)
    stream.once("end", () => {
      if (!output.includes(expected)) {
        reject(new Error(`stream ended before emitting: ${expected}`))
      }
    })
  })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "local-test-lock-"))
  lockPath = path.join(tmp, "test.lock")
})

afterEach(() => {
  for (const child of children) {
    child.kill()
  }
  children.clear()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe("with-local-test-lock", () => {
  it("serializes test commands that share the machine lock", async () => {
    const first = spawnLocked(`
      process.stdout.write("first-started\\n")
      process.stdin.once("data", () => process.exit(0))
    `)
    const firstExit = waitForExit(first)
    await waitForText(first.stdout, "first-started")

    const second = spawnLocked('process.stdout.write("second-started\\n")')
    const secondExit = waitForExit(second)
    let secondOutput = ""
    second.stdout.on("data", (chunk) => {
      secondOutput += chunk.toString()
    })

    await waitForText(second.stderr, "waiting for the machine-wide test lock")
    expect(secondOutput).toBe("")

    first.stdin.end("release\n")
    await firstExit
    await secondExit

    expect(secondOutput).toContain("second-started")
  })

  it("is reentrant and applies a nested package's lower cap", async () => {
    const { stdout } = await execFileAsync(
      "bash",
      [
        SCRIPT,
        "env",
        "BITFAB_LOCAL_TEST_MAX_WORKERS=2",
        "bash",
        SCRIPT,
        process.execPath,
        "-e",
        'process.stdout.write(process.env.VITEST_MAX_WORKERS ?? "missing")',
      ],
      {
        env: localTestEnv({
          BITFAB_LOCAL_TEST_CPU_COUNT: "12",
          BITFAB_LOCAL_TEST_LOCK_PATH: lockPath,
        }),
      },
    )

    expect(stdout).toBe("2")
  })

  it("preserves a package-specific worker override", async () => {
    const { stdout } = await execFileAsync(
      "bash",
      [
        SCRIPT,
        process.execPath,
        "-e",
        'process.stdout.write(process.env.VITEST_MAX_WORKERS ?? "missing")',
      ],
      {
        env: localTestEnv({
          BITFAB_LOCAL_TEST_CPU_COUNT: "12",
          BITFAB_LOCAL_TEST_LOCK_PATH: lockPath,
          BITFAB_LOCAL_TEST_MAX_WORKERS: "2",
        }),
      },
    )

    expect(stdout).toBe("2")
  })

  it.each([
    [8, 4],
    [4, 2],
    [2, 1],
    [1, 1],
  ])("uses half of %i CPUs up to the four-worker cap", async (cpus, workers) => {
    const { stdout } = await execFileAsync(
      "bash",
      [
        SCRIPT,
        process.execPath,
        "-e",
        'process.stdout.write(process.env.VITEST_MAX_WORKERS ?? "missing")',
      ],
      {
        env: localTestEnv({
          BITFAB_LOCAL_TEST_CPU_COUNT: String(cpus),
          BITFAB_LOCAL_TEST_LOCK_PATH: lockPath,
        }),
      },
    )

    expect(stdout).toBe(String(workers))
  })

  it("bypasses both the lock and worker cap in CI", async () => {
    const env = {
      ...process.env,
      BITFAB_LOCAL_TEST_LOCK_PATH: "/dev/null/bitfab-test.lock",
      BITFAB_LOCAL_TEST_MAX_WORKERS: "2",
      CI: "true",
    }
    delete env.VITEST_MAX_WORKERS

    const { stdout } = await execFileAsync(
      "bash",
      [
        SCRIPT,
        process.execPath,
        "-e",
        'process.stdout.write(process.env.VITEST_MAX_WORKERS ?? "missing")',
      ],
      { env },
    )

    expect(stdout).toBe("missing")
  })
})
