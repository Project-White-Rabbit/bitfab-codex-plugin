import { runReapDaemon } from "bitfab-plugin-lib";
runReapDaemon().catch((err) => {
    console.error("Failed to reap daemon:", err.message);
    process.exit(1);
});
