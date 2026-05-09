import { defineConfig, devices } from "@playwright/test";

/**
 * Minimal Playwright config. Boots the static dev server on :3000 (no
 * multiplayer — single-player / computer modes don't need the worker)
 * and runs specs in headless Chromium.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4040",
    trace: "retain-on-failure",
    headless: true,
    extraHTTPHeaders: {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // FBG on :4040 to avoid colliding with the user's other dev server on :3000.
    command: "PORT=4040 node server-local.js",
    url: "http://localhost:4040",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
