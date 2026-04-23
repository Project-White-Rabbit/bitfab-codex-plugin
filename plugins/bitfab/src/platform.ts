import type { PlatformConfig } from "bitfab-plugin-lib"

export const platform: PlatformConfig = {
  authPath: "codex",
  loginHint: "$bitfab:setup login",
  setupHint: "$bitfab:setup",
  updateHint: "codex plugin marketplace upgrade bitfab",
  repo: "Project-White-Rabbit/bitfab-codex-plugin",
  remotePackageJsonPath: "plugins/bitfab/package.json",
  cliBinary: "codex",
  displayName: "Codex",
  supportsAutoUpdate: true,
  marketplaceName: "bitfab",
  pluginName: "bitfab",
  marketplacePreRegistered: false,
  pluginUpdateCommands: ["codex plugin marketplace upgrade bitfab"],
}
