import { runOpenExperiments } from "bitfab-plugin-lib"
import { platform } from "../platform.js"

runOpenExperiments(platform).catch((err) => {
  console.error("Failed to open experiments page:", err.message)
  process.exit(1)
})
