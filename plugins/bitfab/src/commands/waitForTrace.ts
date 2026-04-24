import { runWaitForTrace } from "bitfab-plugin-lib"
import { platform } from "../platform.js"
import { getVersion } from "../version.js"

runWaitForTrace(platform, getVersion()).catch((err) => {
  console.error("Wait for trace failed:", err.message)
  process.exit(1)
})
