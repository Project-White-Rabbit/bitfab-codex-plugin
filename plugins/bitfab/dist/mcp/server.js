import { getConfig, startMcpServer } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { getVersion } from "../version.js";
startMcpServer(platform, getConfig, getVersion()).catch((err) => {
    console.error("Bitfab MCP server failed to start:", err);
    process.exit(1);
});
