import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // tmp/ holds the vendored dev-install plugin tree (gitignored, created by
    // scripts/install-dev.sh); never run its bundled tests.
    exclude: ["dist/**", "node_modules/**", "tmp/**"],
    testTimeout: 15_000,
  },
})
