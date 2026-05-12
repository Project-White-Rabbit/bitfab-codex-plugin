import { runOpenStudio } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
runOpenStudio(platform).catch((err) => {
    console.error("Failed to open Studio:", err.message);
    process.exit(1);
});
