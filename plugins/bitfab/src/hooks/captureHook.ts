import { type HookType, runCaptureHook } from "bitfab-plugin-lib"

await runCaptureHook(process.argv[2] as HookType, "codex")
