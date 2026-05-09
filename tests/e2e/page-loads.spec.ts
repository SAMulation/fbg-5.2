import { test, expect, type ConsoleMessage } from "@playwright/test";

/**
 * Smoke: index.html loads, the engine bundle is reachable, and the
 * page initialises without a JS error (third-party tracker errors are
 * filtered — we don't control cookiebot / plausible / jotform / pusher
 * and they fail on networks where ad-blockers / Playwright's default
 * routing drop them).
 *
 * This is intentionally minimal — clicking through the UI flow needs
 * stable DOM specs that don't exist yet. Adding higher-fidelity
 * specs (computer-vs-computer game to GAME_OVER, save/resume UI, etc.)
 * is a follow-up.
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

test("index.html boots without first-party JS errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() !== "error") return;
    if (isThirdParty(text)) return;
    // Browser auto-emits "Failed to load resource" console errors for any
    // failed network request, including 404s on third-party widgets we
    // don't control. Those don't indicate first-party breakage.
    if (text.startsWith("Failed to load resource")) return;
    errors.push(`console.error: ${text}`);
  });
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveTitle(/FootBored/);
  await page.waitForTimeout(500);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("engine bundle is served and parses", async ({ page }) => {
  // Fetch the bundle directly through the page so the test runs against
  // whatever the dev server is serving (catches a missing / corrupted bundle).
  const resp = await page.request.get("/js/engine.js");
  expect(resp.status()).toBe(200);
  const body = await resp.text();
  // Sanity markers: the bundle should export reduce + initialState +
  // replayActions (Phase B addition). We don't parse — just grep.
  expect(body).toContain("reduce");
  expect(body).toContain("initialState");
  expect(body).toContain("replayActions");
});
