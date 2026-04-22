import { CREDENTIALS_FILE, deleteCredentials, hasCredentials, } from "../config.js";
export function runLogout() {
    if (!hasCredentials()) {
        console.log("Not logged in — no credentials to remove.");
        return;
    }
    deleteCredentials();
    console.log(`Credentials removed from ${CREDENTIALS_FILE}`);
    console.log("Logged out of Bitfab.");
}
