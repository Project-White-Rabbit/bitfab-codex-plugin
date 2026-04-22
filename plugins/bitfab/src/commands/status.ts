import { runStatus } from "bitfab-plugin-lib"
import { platform } from "../platform.js"
import { PLUGIN_ROOT } from "../pluginRoot.js"
import { getVersion } from "../version.js"

runStatus(getVersion(), platform, PLUGIN_ROOT, import.meta.url).catch((err) => {
  console.error("Status check failed:", err.message)
  process.exit(1)
})
