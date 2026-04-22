import { runLogin } from "bitfab-plugin-lib"
import { platform } from "../platform.js"
import { getVersion } from "../version.js"

runLogin(platform, getVersion()).catch((err) => {
  console.error("Login failed:", err.message)
  process.exit(1)
})
