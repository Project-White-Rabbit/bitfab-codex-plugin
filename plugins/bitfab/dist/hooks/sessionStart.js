import { spawn } from "node:child_process";
import path from "node:path";
import { readHookStdin, runCaptureHook, runSessionStart, } from "bitfab-plugin-lib";
import { recordCodexSessionRuntime } from "../codexSessionRuntime.js";
import { platform } from "../platform.js";
import { PLUGIN_ROOT } from "../pluginRoot.js";
import { getVersion } from "../version.js";
const input = readHookStdin();
recordCodexSessionRuntime(input);
const threadId = input?.session_id ?? process.env.CODEX_THREAD_ID;
if (threadId) {
    try {
        spawn(process.execPath, [
            path.join(PLUGIN_ROOT, "dist", "hooks", "experimentWaker.js"),
            "--thread-id",
            threadId,
            "--codex-pid",
            String(process.ppid),
            ...(input?.transcript_path ? ["--rollout", input.transcript_path] : []),
        ], { detached: true, stdio: "ignore" }).unref();
    }
    catch { }
}
await Promise.all([
    runSessionStart(getVersion(), platform, PLUGIN_ROOT, import.meta.url, input?.session_id),
    runCaptureHook("SessionStart", "codex", input, getVersion()).catch(() => { }),
]);
