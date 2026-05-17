import { runViewLastTracePlan } from "bitfab-plugin-lib"
import { platform } from "../platform.js"

runViewLastTracePlan(platform).catch((err) => {
  console.error("Failed to open last trace plan:", err.message)
  process.exit(1)
})
