import { runReadTracesBatched } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { getVersion } from "../version.js";
runReadTracesBatched(platform, getVersion()).catch((err) => {
    console.error("Read traces (batched) failed:", err.message);
    process.exit(1);
});
