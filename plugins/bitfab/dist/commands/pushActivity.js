import { runPushActivity } from "bitfab-plugin-lib";
runPushActivity().catch((err) => {
    console.error("Push activity failed:", err.message);
    process.exit(1);
});
