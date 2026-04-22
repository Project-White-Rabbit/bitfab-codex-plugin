import { parseUpdateMode, runUpdate } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { getVersion } from "../version.js";
const mode = parseUpdateMode(process.argv[2]);
runUpdate(getVersion(), platform, mode).catch((err) => {
    console.error("Update failed:", err.message);
    process.exit(1);
});
