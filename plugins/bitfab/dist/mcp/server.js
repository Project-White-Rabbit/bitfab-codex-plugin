import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig, startMcpServer } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { getVersion } from "../version.js";
function getCodexSessionCwd() {
    const logPath = process.env.CODEX_TUI_SESSION_LOG_PATH;
    if (!logPath) {
        return null;
    }
    try {
        const content = fs.readFileSync(logPath, "utf-8");
        const newlineIndex = content.indexOf("\n");
        const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex);
        const parsed = JSON.parse(firstLine);
        return typeof parsed.cwd === "string" && fs.existsSync(parsed.cwd)
            ? parsed.cwd
            : null;
    }
    catch {
        return null;
    }
}
function getCodexDevMarketplaceCwd() {
    const cwd = process.cwd();
    const parts = cwd.split(path.sep);
    const cacheIndex = parts.lastIndexOf("cache");
    const marketplaceName = cacheIndex === -1 ? null : parts[cacheIndex + 1];
    if (!marketplaceName?.startsWith("bitfab-internal-")) {
        return null;
    }
    const configPath = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"), "config.toml");
    try {
        const content = fs.readFileSync(configPath, "utf-8");
        const sectionHeader = `[marketplaces.${marketplaceName}]`;
        const lines = content.split("\n");
        const start = lines.findIndex((line) => line.trim() === sectionHeader);
        if (start === -1) {
            return null;
        }
        for (let i = start + 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.startsWith("[") && line.endsWith("]")) {
                break;
            }
            const match = line.match(/^source\s*=\s*"(.+)"$/);
            if (match) {
                const source = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
                const projectRoot = path.dirname(path.dirname(source));
                return fs.existsSync(projectRoot) ? projectRoot : null;
            }
        }
    }
    catch { }
    return null;
}
const sessionCwd = getCodexSessionCwd() ?? getCodexDevMarketplaceCwd();
if (sessionCwd) {
    process.chdir(sessionCwd);
}
startMcpServer(platform, getConfig, getVersion()).catch((err) => {
    console.error("Bitfab MCP server failed to start:", err);
    process.exit(1);
});
