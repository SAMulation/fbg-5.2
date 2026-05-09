import { test, expect } from "@playwright/test";

/**
 * Regression: scoreboard must update visibly during a SLOW (no `?fast=1`)
 * CPU-vs-CPU game. Previously the engine state advanced correctly but
 * `showBoard()` was only called at game setup and after kickoff/OT-start,
 * so the on-screen clock / down / spot froze at "7:00 1st / 1st & 10".
 *
 * After the fix, `_applyStateToGame` calls `showBoard` every state
 * broadcast, so each play (and clock tick) refreshes the DOM.
 */
test("scoreboard clock + down/distance update mid-game in slow mode", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("dialog", (d) => d.accept().catch(() => {}));

  // 1-min quarters keep the test bounded; no ?fast=1 so animations run.
  await page.goto("/?dev=computer&t1=NE&t2=GB&q=1");

  const clockSel = ".clock .time";
  // Wait for the clock to mount (post prepareHTML).
  await page.waitForSelector(clockSel, { timeout: 10_000 });

  // Initial value should be "7:00" (1-min quarter starts at full time).
  // Note: this is the QUARTER LENGTH on the clock. Wait until plays start
  // and the clock has decremented.
  const initial = (await page.locator(clockSel).innerText()).trim();
  expect(initial).toMatch(/^\d+:\d\d$/);

  // Wait for the first play to resolve and the clock to decrement.
  // With site.animation=false this is fast (~100-300ms per play).
  await page.waitForFunction(
    (init) => {
      const el = document.querySelector(".clock .time") as HTMLElement | null;
      const txt = (el?.innerText ?? "").trim();
      return txt && txt !== init;
    },
    initial,
    { timeout: 15_000 },
  );

  const after = (await page.locator(clockSel).innerText()).trim();
  expect(after).not.toBe(initial);
  expect(after).toMatch(/^\d+:\d\d$/);

  // Down/distance: at game start the offense's down message is "1st & 10".
  // After at least one play it should NOT still be "1st & 10" forever —
  // wait for it to change OR for the score to change. Either proves
  // the scoreboard re-renders post-play. We give plenty of slack since
  // a string of first downs could keep "1st & 10" indefinitely.
  await page.waitForFunction(
    () => {
      const home = document.querySelector(".home-msg.bot-msg") as HTMLElement | null;
      const away = document.querySelector(".away-msg.bot-msg") as HTMLElement | null;
      const homeScore = document.querySelector(".home.score") as HTMLElement | null;
      const awayScore = document.querySelector(".away.score") as HTMLElement | null;
      const downs = `${home?.innerText ?? ""}|${away?.innerText ?? ""}`;
      const scores = `${homeScore?.innerText ?? "0"}|${awayScore?.innerText ?? "0"}`;
      // Either down/distance moved off "1st & 10" both sides, or any
      // score moved off zero, or yards-to-go changed.
      const onlyOneTen = /1st\s*&\s*10/.test(downs) && !/2nd|3rd|4th/.test(downs);
      const noScore = scores === "0|0";
      return !onlyOneTen || !noScore;
    },
    null,
    { timeout: 30_000 },
  );
});
