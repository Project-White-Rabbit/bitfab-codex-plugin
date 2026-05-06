import { runStartTemplatePreview } from "bitfab-plugin-lib"
import { platform } from "../platform.js"
import { getVersion } from "../version.js"

runStartTemplatePreview(platform, getVersion()).catch((err) => {
  console.error("Failed to open template preview page:", err.message)
  process.exit(1)
})
