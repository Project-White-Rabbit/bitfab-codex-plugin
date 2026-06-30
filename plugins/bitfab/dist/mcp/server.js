import { spawn } from "node:child_process";
import path from "node:path";
import { getConfig, startMcpServer } from "bitfab-plugin-lib";
import { resolveCodexSessionRuntime, runtimeServerPath, } from "../codexSessionRuntime.js";
import { platform } from "../platform.js";
import { PLUGIN_ROOT } from "../pluginRoot.js";
import { getVersion } from "../version.js";
const RUNTIME_WAIT_MS = 5_000;
const RUNTIME_POLL_MS = 100;
function hasCodexSessionId() {
    return Boolean(process.env.CODEX_THREAD_ID || process.env.AGENT_SESSION_ID);
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function setRuntimeProjectEnv(worktree) {
    process.env.BITFAB_PROJECT_ROOT ??= worktree;
    process.env.BITFAB_WORKSPACE_ROOT ??= worktree;
}
async function resolveRuntimeForMcp() {
    let runtime = resolveCodexSessionRuntime();
    if (runtime || !hasCodexSessionId()) {
        return runtime;
    }
    const deadline = Date.now() + RUNTIME_WAIT_MS;
    while (Date.now() < deadline) {
        await sleep(RUNTIME_POLL_MS);
        runtime = resolveCodexSessionRuntime();
        if (runtime) {
            return runtime;
        }
    }
    return null;
}
async function delegateToSessionRuntime() {
    if (process.env.BITFAB_CODEX_RUNTIME_DELEGATED === "1") {
        return false;
    }
    const runtime = await resolveRuntimeForMcp();
    if (!runtime) {
        return false;
    }
    setRuntimeProjectEnv(runtime.worktree);
    process.chdir(runtime.worktree);
    const serverPath = runtimeServerPath(runtime);
    if (!serverPath) {
        return false;
    }
    const bundledServerPath = path.join(PLUGIN_ROOT, "dist", "mcp", "server.js");
    if (path.resolve(serverPath) === path.resolve(bundledServerPath)) {
        return false;
    }
    const child = spawn(process.execPath, [serverPath], {
        cwd: runtime.worktree,
        env: {
            ...process.env,
            BITFAB_CODEX_RUNTIME_DELEGATED: "1",
            BITFAB_CODEX_SHIM_ROOT: PLUGIN_ROOT,
            BITFAB_PROJECT_ROOT: process.env.BITFAB_PROJECT_ROOT ?? runtime.worktree,
            BITFAB_WORKSPACE_ROOT: process.env.BITFAB_WORKSPACE_ROOT ?? runtime.worktree,
        },
        stdio: "inherit",
    });
    const delegated = await new Promise((resolve) => {
        let settled = false;
        child.once("error", (err) => {
            if (settled) {
                return;
            }
            settled = true;
            console.error("Bitfab MCP runtime delegation failed:", err);
            resolve(false);
        });
        child.once("exit", (code, signal) => {
            if (settled) {
                return;
            }
            settled = true;
            if (signal) {
                process.kill(process.pid, signal);
                return;
            }
            if (code === 0) {
                process.exit(0);
            }
            console.error(`Bitfab MCP runtime delegation exited with code ${code ?? "unknown"}`);
            resolve(false);
        });
    });
    return delegated;
}
async function startBundledMcpServer() {
    const runtime = await resolveRuntimeForMcp();
    if (runtime) {
        setRuntimeProjectEnv(runtime.worktree);
        process.chdir(runtime.worktree);
    }
    startMcpServer(platform, getConfig, getVersion()).catch((err) => {
        console.error("Bitfab MCP server failed to start:", err);
        process.exit(1);
    });
}
try {
    if (!(await delegateToSessionRuntime())) {
        await startBundledMcpServer();
    }
}
catch (err) {
    console.error("Bitfab MCP runtime delegation failed:", err);
    await startBundledMcpServer();
}
