import { runSessionStart } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { PLUGIN_ROOT } from "../pluginRoot.js";
import { getVersion } from "../version.js";
await runSessionStart(getVersion(), platform, PLUGIN_ROOT, import.meta.url);
