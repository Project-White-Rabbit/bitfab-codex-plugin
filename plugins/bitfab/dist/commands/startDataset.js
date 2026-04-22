import { runStartDataset } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { getVersion } from "../version.js";
runStartDataset(platform, getVersion()).catch((err) => {
    console.error("Failed to open dataset page:", err.message);
    process.exit(1);
});
