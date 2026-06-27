import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
describe("command surface", () => {
    it("stays consistent across Bitfab editor plugins", () => {
        expect(() => {
            execFileSync("node", [path.resolve("../scripts/check-bitfab-plugin-command-surface.mjs")], { stdio: "pipe" });
        }).not.toThrow();
    });
});
