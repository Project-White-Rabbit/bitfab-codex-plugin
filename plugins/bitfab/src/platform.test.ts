import { describe, expect, it } from "vitest"
import { platform } from "./platform.js"

describe("platform", () => {
  it("uses Codex-native plugin wiring", () => {
    expect(platform.authPath).toBe("codex")
    expect(platform.displayName).toBe("Codex")
    expect(platform.cliBinary).toBe("codex")
    expect(platform.supportsAutoUpdate).toBe(true)
    expect(platform.marketplaceName).toBe("bitfab")
    expect(platform.pluginName).toBe("bitfab")
  })
})
