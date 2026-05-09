import { test, expect } from "@playwright/test";

/**
 * Verifies that "0.3s game finished" is actually a real game with a
 * realistic action count. A real 7-minute-quarter game runs ~80-200
 * engine actions (kickoffs, picks, ticks, PATs, etc). Anything less
 * than ~30 means the loop bailed early.
 */
test("multi.html plays real games (action count + plays.run)", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto("/multi.html");

  // Force 7-minute quarters and restart so we test FULL-length games.
  await page.locator("#qtrLen").fill("7");
  await page.locator("#restart").click();

  // Wait for all done.
  await expect(page.locator("#globalStatus")).toContainText(
    "All 3 games finished",
    { timeout: 50_000 },
  );

  // Reach into each iframe and pull the LocalChannel.actionLog length
  // plus the engine's final state (phase + clock + scores).
  const reports = await page.evaluate(async () => {
    const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>(".game-pane iframe"));
    const out: Array<Record<string, unknown>> = [];
    for (const f of iframes) {
      const w = f.contentWindow as unknown as {
        game?: {
          engineState?: {
            phase?: string;
            clock?: { quarter?: number; secondsRemaining?: number };
            players?: Record<number, { score?: number; team?: { id?: string } }>;
          };
        };
        // localSession's LocalChannel attaches its actionLog to the
        // pusher's internal channel. Pull it via a back-door reach.
      };
      const g = w?.game;
      const channel = (w as unknown as { __fbgChannel?: { actionLog?: unknown[] } }).__fbgChannel;
      out.push({
        phase: g?.engineState?.phase,
        quarter: g?.engineState?.clock?.quarter,
        secondsRemaining: g?.engineState?.clock?.secondsRemaining,
        score1: g?.engineState?.players?.[1]?.score,
        score2: g?.engineState?.players?.[2]?.score,
        team1: g?.engineState?.players?.[1]?.team?.id,
        team2: g?.engineState?.players?.[2]?.team?.id,
        actionLogLength: Array.isArray(channel?.actionLog) ? channel?.actionLog?.length : null,
      });
    }
    return out;
  });

  console.log("\n--- per-game reports ---");
  for (let i = 0; i < reports.length; i++) {
    console.log(`game ${i + 1}:`, JSON.stringify(reports[i]));
  }

  // Dump action-type histogram from game 1 so we know what's actually firing.
  const histogram = await page.evaluate(() => {
    const f = document.querySelector<HTMLIFrameElement>(".game-pane iframe");
    const w = f?.contentWindow as unknown as { __fbgChannel?: { actionLog?: { type: string }[] } };
    const log = w?.__fbgChannel?.actionLog ?? [];
    const types: Record<string, number> = {};
    for (const a of log) types[a.type] = (types[a.type] ?? 0) + 1;
    return { total: log.length, types, sample: log.slice(0, 12) };
  });
  console.log("\n--- game 1 action histogram ---");
  console.log(JSON.stringify(histogram, null, 2));

  for (const r of reports) {
    expect(r.phase, "must reach GAME_OVER").toBe("GAME_OVER");
    // 7-min quarters: 4 × (420/30) = 56 TICK_CLOCK actions minimum,
    // 2 PICK_PLAY per play = 112+, plus init/kickoff/PAT overhead.
    // Realistic floor: 150 actions. Anything below means the loop bailed.
    const n = r.actionLogLength as number | null;
    if (n != null) expect(n, `action log too short: ${n}`).toBeGreaterThan(120);
  }
});
