import { runOpenDatasetExperiments } from "bitfab-plugin-lib"
import { platform } from "../platform.js"

runOpenDatasetExperiments(platform).catch((err) => {
  console.error("Failed to open dataset experiments page:", err.message)
  process.exit(1)
})
