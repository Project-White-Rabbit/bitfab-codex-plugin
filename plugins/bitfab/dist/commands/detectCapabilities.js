import { runDetectCapabilities } from "bitfab-plugin-lib";
runDetectCapabilities(process.argv[2]).catch((err) => {
    console.error("Capability detection failed:", err.message);
    process.exit(1);
});
