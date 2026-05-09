import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * CPU-vs-CPU walkthrough smoke. Loads `?dev=computer&t1=NE&t2=GB&q=1`
 * which the start screen reads to skip team selection and launch a
 * 0-player game with 1-minute quarters (fast). Asserts the game reaches
 * GAME_OVER without first-party JS errors.
 *
 * 1-minute quarters keeps the test bounded — full 7-minute quarters
 * would push past the timeout when animations run normally.
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
    const text = msg.text();
    if (msg.type() !== "error") return;
    if (isThirdParty(text)) return;
    if (text.startsWith("Failed to load resource")) return;
    errors.push(`console.error: ${text}`);
  });
  return errors;
}

test("CPU-vs-CPU 1-minute-quarter game reaches GAME_OVER", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = attachErrorCollector(page);
  await page.goto("/?dev=computer&t1=NE&t2=GB&q=1&fast=1");

  // Auto-accept any alertBox / confirm dialogs that fire during the game
  // (kickoff banner, two-minute warning, etc).
  page.on("dialog", (d) => d.accept().catch(() => {}));

  // Wait until window.game.engineState.phase === 'GAME_OVER'. The driver
  // stamps state onto window.game after every broadcast; polling that is
  // the cleanest way to detect end-of-game without depending on DOM text
  // that might change.
  await page.waitForFunction(
    () => {
      const g = (window as unknown as { game?: { engineState?: { phase?: string } } }).game;
      return g?.engineState?.phase === "GAME_OVER";
    },
    null,
    { timeout: 100_000 },
  );

  // Sanity: scoreboard fields are present.
  const finalState = await page.evaluate(() => {
    const g = (window as unknown as { game?: { engineState?: unknown } }).game;
    return g?.engineState;
  });
  expect(finalState).toBeTruthy();
  expect((finalState as { phase: string }).phase).toBe("GAME_OVER");

  expect(errors, errors.join("\n")).toEqual([]);
});
