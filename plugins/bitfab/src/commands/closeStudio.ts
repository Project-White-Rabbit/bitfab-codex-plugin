import { runCloseStudio } from "bitfab-plugin-lib"

runCloseStudio().catch((err) => {
  console.error("Failed to close Studio:", err.message)
  process.exit(1)
})
