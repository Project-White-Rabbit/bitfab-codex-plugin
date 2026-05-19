import { readHookStdin, runCaptureHook, runSessionStart, } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { PLUGIN_ROOT } from "../pluginRoot.js";
import { getVersion } from "../version.js";
const input = readHookStdin();
await Promise.all([
    runSessionStart(getVersion(), platform, PLUGIN_ROOT, import.meta.url, input?.session_id),
    runCaptureHook("SessionStart", "codex", input).catch(() => { }),
]);
