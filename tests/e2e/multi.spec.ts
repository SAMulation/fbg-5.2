import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * /multi.html spawns N CPU-vs-CPU games in iframes, all running with
 * ?fast=1. Verify all 3 games reach GAME_OVER and the parent page
 * surfaces final scores.
 */

const THIRD_PARTY_HOSTS = [
  "consent.cookiebot.com",
  "plausible.io",
  "form.jotform.com",
  "js.pusher.com",
  "fonts.googleapis.com",
];
const isThirdParty = (text: string) =>
  THIRD_PARTY_HOSTS.some((h) => text.includes(h));

function attachErrorCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isThirdParty(text)) return;
    if (text.startsWith("Failed to load resource")) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

test("/multi.html runs 3 CPU-vs-CPU games to GAME_OVER", async ({ page }) => {
  test.setTimeout(60_000);
  const errors = attachErrorCollector(page);
  page.on("dialog", (d) => d.accept().catch(() => {}));

  await page.goto("/multi.html");

  // Wait until the parent page's status reads "All 3 games finished".
  await expect(page.locator("#globalStatus")).toContainText(
    "All 3 games finished",
    { timeout: 50_000 },
  );

  // Each pane should have a "done" status with a score string like "NE 14 – GB 7 (1.6s)".
  const panes = page.locator(".game-pane [data-status]");
  await expect(panes).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(panes.nth(i)).toHaveClass(/done/);
    await expect(panes.nth(i)).toContainText(/\d+\s*–\s*\w+\s*\d+/);
  }

  expect(errors, errors.join("\n")).toEqual([]);
});
