import { runOpenTracePlan } from "bitfab-plugin-lib"
import { platform } from "../platform.js"
import { getVersion } from "../version.js"

runOpenTracePlan(platform, getVersion()).catch((err) => {
  console.error("Failed to open trace plan:", err.message)
  process.exit(1)
})
