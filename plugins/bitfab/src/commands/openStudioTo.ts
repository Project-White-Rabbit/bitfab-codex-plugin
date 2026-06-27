import { runOpenStudioTo } from "bitfab-plugin-lib"
import { platform } from "../platform.js"

runOpenStudioTo(platform).catch((err) => {
  console.error("Failed to open Studio:", err.message)
  process.exit(1)
})
