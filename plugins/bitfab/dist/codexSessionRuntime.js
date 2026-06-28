import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
function codexHome() {
    return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
}
function firstNonEmpty(...values) {
    return values.find((value) => Boolean(value)) ?? null;
}
function codexSessionId(input) {
    return firstNonEmpty(input?.session_id, process.env.CODEX_THREAD_ID, process.env.AGENT_SESSION_ID);
}
export function sessionRuntimePath(sessionId) {
    return path.join(codexHome(), "bitfab", "sessions", `${sessionId}.json`);
}
function findRepoRoot(start) {
    let current = path.resolve(start);
    try {
        const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
            cwd: current,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (root && fs.existsSync(root)) {
            return root;
        }
    }
    catch { }
    while (true) {
        if (fs.existsSync(path.join(current, "pnpm-workspace.yaml")) &&
            fs.existsSync(path.join(current, "bitfab-codex-plugin"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return null;
        }
        current = parent;
    }
}
function cwdFromSessionLog() {
    const logPath = process.env.CODEX_TUI_SESSION_LOG_PATH;
    if (!logPath) {
        return null;
    }
    try {
        const content = fs.readFileSync(logPath, "utf-8");
        const newlineIndex = content.indexOf("\n");
        const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
        const parsed = JSON.parse(firstLine);
        return typeof parsed.cwd === "string" && fs.existsSync(parsed.cwd)
            ? parsed.cwd
            : null;
    }
    catch {
        return null;
    }
}
function resolveCodexWorktree(input) {
    const candidates = [
        input?.cwd,
        process.env.SUPERSET_WORKSPACE_PATH,
        cwdFromSessionLog(),
        process.cwd(),
    ].filter((candidate) => Boolean(candidate));
    for (const candidate of candidates) {
        const root = findRepoRoot(candidate);
        if (root) {
            return root;
        }
    }
    return null;
}
function runtimeForWorktree(worktree) {
    const sessionId = codexSessionId() ?? "unknown";
    return {
        sessionId,
        worktree,
        bitfabRuntime: path.join(worktree, "bitfab-codex-plugin"),
        bitfabDevRuntime: path.join(worktree, "bitfab-dev-codex-plugin"),
        recordedAt: new Date().toISOString(),
    };
}
export function recordCodexSessionRuntime(input) {
    const sessionId = codexSessionId(input);
    const worktree = resolveCodexWorktree(input);
    if (!sessionId || !worktree) {
        return null;
    }
    const runtime = {
        ...runtimeForWorktree(worktree),
        sessionId,
    };
    const outputPath = sessionRuntimePath(sessionId);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(runtime, null, 2)}\n`);
    return runtime;
}
export function readCodexSessionRuntime(sessionId = codexSessionId() ?? undefined) {
    if (!sessionId) {
        return null;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(sessionRuntimePath(sessionId), "utf-8"));
        if (typeof parsed.worktree === "string" &&
            fs.existsSync(parsed.worktree) &&
            typeof parsed.bitfabRuntime === "string") {
            return parsed;
        }
    }
    catch { }
    return null;
}
export function resolveCodexSessionRuntime(input) {
    return (readCodexSessionRuntime(codexSessionId(input) ?? undefined) ??
        recordCodexSessionRuntime(input));
}
export function runtimeServerPath(runtime) {
    const serverPath = path.join(runtime.bitfabRuntime, "dist", "mcp", "server.js");
    return fs.existsSync(serverPath) ? serverPath : null;
}
