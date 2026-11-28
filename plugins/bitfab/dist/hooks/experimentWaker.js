import { runCodexExperimentWaker } from "bitfab-plugin-lib";
import { platform } from "../platform.js";
import { getVersion } from "../version.js";
await runCodexExperimentWaker(platform, getVersion()).catch(() => undefined);
process.exit(0);
