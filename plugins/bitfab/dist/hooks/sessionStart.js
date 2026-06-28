import { readHookStdin, runCaptureHook, runSessionStart, } from "bitfab-plugin-lib";
import { recordCodexSessionRuntime } from "../codexSessionRuntime.js";
import { platform } from "../platform.js";
import { PLUGIN_ROOT } from "../pluginRoot.js";
import { getVersion } from "../version.js";
const input = readHookStdin();
recordCodexSessionRuntime(input);
await Promise.all([
    runSessionStart(getVersion(), platform, PLUGIN_ROOT, import.meta.url, input?.session_id),
    runCaptureHook("SessionStart", "codex", input, getVersion()).catch(() => { }),
]);
