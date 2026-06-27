import { runReplayProgress } from "bitfab-plugin-lib";
runReplayProgress().catch((err) => {
    console.error("Replay progress failed:", err.message);
    process.exit(1);
});
