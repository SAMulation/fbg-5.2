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
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    headless: true,
    // Block third-party trackers (cookiebot, plausible, jotform, pusher)
    // so specs aren't flaky when those domains are unreachable.
    extraHTTPHeaders: {},
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node server-local.js",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
