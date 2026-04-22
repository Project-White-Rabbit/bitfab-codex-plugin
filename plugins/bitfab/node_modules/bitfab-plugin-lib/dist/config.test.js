import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
describe("config", () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
        vi.resetModules();
        delete process.env.BITFAB_API_KEY;
        delete process.env.BITFAB_SERVICE_URL;
        delete process.env.BITFAB_VERBOSE;
        delete process.env.BITFAB_DEBUG;
    });
    afterEach(() => {
        process.env = { ...originalEnv };
    });
    async function importConfig() {
        return import("./config.js");
    }
    describe("getConfig env var overrides", () => {
        it("BITFAB_SERVICE_URL env var overrides file config", async () => {
            process.env.BITFAB_SERVICE_URL = "http://test:9999";
            const { getConfig } = await importConfig();
            expect(getConfig().serviceUrl).toBe("http://test:9999");
        });
        it("BITFAB_API_KEY env var overrides file credentials", async () => {
            process.env.BITFAB_API_KEY = "env-override-key";
            const { getConfig } = await importConfig();
            expect(getConfig().apiKey).toBe("env-override-key");
        });
        it("BITFAB_VERBOSE=true from env", async () => {
            process.env.BITFAB_VERBOSE = "true";
            const { getConfig } = await importConfig();
            expect(getConfig().verbose).toBe(true);
        });
        it("BITFAB_VERBOSE=1 from env", async () => {
            process.env.BITFAB_VERBOSE = "1";
            const { getConfig } = await importConfig();
            expect(getConfig().verbose).toBe(true);
        });
        it("BITFAB_VERBOSE=false from env", async () => {
            process.env.BITFAB_VERBOSE = "false";
            const { getConfig } = await importConfig();
            expect(getConfig().verbose).toBe(false);
        });
        it("BITFAB_VERBOSE=0 from env", async () => {
            process.env.BITFAB_VERBOSE = "0";
            const { getConfig } = await importConfig();
            expect(getConfig().verbose).toBe(false);
        });
        it("BITFAB_DEBUG=true from env", async () => {
            process.env.BITFAB_DEBUG = "true";
            const { getConfig } = await importConfig();
            expect(getConfig().debug).toBe(true);
        });
        it("BITFAB_DEBUG=1 from env", async () => {
            process.env.BITFAB_DEBUG = "1";
            const { getConfig } = await importConfig();
            expect(getConfig().debug).toBe(true);
        });
    });
    describe("getConfig returns valid structure", () => {
        it("returns all expected fields", async () => {
            const { getConfig } = await importConfig();
            const config = getConfig();
            expect(config).toHaveProperty("serviceUrl");
            expect(config).toHaveProperty("apiKey");
            expect(config).toHaveProperty("verbose");
            expect(config).toHaveProperty("debug");
            expect(typeof config.serviceUrl).toBe("string");
            expect(typeof config.verbose).toBe("boolean");
            expect(typeof config.debug).toBe("boolean");
        });
        it("serviceUrl is a valid URL", async () => {
            const { getConfig } = await importConfig();
            const { serviceUrl } = getConfig();
            expect(() => new URL(serviceUrl)).not.toThrow();
        });
    });
    describe("hasCredentials", () => {
        it("returns true when env var is set", async () => {
            process.env.BITFAB_API_KEY = "env-key";
            const { hasCredentials } = await importConfig();
            expect(hasCredentials()).toBe(true);
        });
    });
    describe("saveCredentials and deleteCredentials", () => {
        const configDir = path.join(os.homedir(), ".config", "bitfab");
        const credFile = path.join(configDir, "credentials.json");
        let existingCreds;
        beforeEach(() => {
            try {
                existingCreds = fs.readFileSync(credFile, "utf-8");
            }
            catch {
                existingCreds = null;
            }
        });
        afterEach(() => {
            if (existingCreds) {
                fs.writeFileSync(credFile, existingCreds);
            }
        });
        it("saveCredentials writes and reads back the key", async () => {
            const { saveCredentials, getConfig } = await importConfig();
            const testKey = `test-key-${Date.now()}`;
            saveCredentials(testKey);
            const content = JSON.parse(fs.readFileSync(credFile, "utf-8"));
            expect(content.apiKey).toBe(testKey);
            const config = getConfig();
            expect(config.apiKey).toBe(testKey);
            if (existingCreds) {
                fs.writeFileSync(credFile, existingCreds);
            }
            else {
                fs.unlinkSync(credFile);
            }
        });
        it("deleteCredentials removes the file", async () => {
            const { saveCredentials, deleteCredentials } = await importConfig();
            saveCredentials("key-to-delete");
            expect(fs.existsSync(credFile)).toBe(true);
            deleteCredentials();
            expect(fs.existsSync(credFile)).toBe(false);
            if (existingCreds) {
                fs.mkdirSync(configDir, { recursive: true });
                fs.writeFileSync(credFile, existingCreds);
            }
        });
        it("deleteCredentials does not throw when no file exists", async () => {
            const { deleteCredentials } = await importConfig();
            if (fs.existsSync(credFile)) {
                fs.unlinkSync(credFile);
            }
            expect(() => deleteCredentials()).not.toThrow();
            if (existingCreds) {
                fs.mkdirSync(configDir, { recursive: true });
                fs.writeFileSync(credFile, existingCreds);
            }
        });
    });
});
