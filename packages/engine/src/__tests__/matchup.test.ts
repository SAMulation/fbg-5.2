/**
 * Matchup matrix tests — these lock in the play-quality scoring that has
 * defined FBG since the paper version on the calculator.
 *
 * If any of these break, a core mechanic has been lost. Don't "fix" the test —
 * find what changed in the matrix.
 */

import { describe, expect, it } from "vitest";
import { MATCHUP, matchupQuality } from "../rules/matchup.js";
import { computeYardage } from "../rules/yardage.js";

describe("MATCHUP matrix", () => {
  it("matches the v5.1 source matrix exactly", () => {
    expect(MATCHUP).toEqual([
      [5, 3, 3, 2],
      [2, 4, 1, 2],
      [3, 2, 5, 3],
      [1, 2, 2, 4],
    ]);
  });

  // Quality semantics: 1 = great for offense (defense wrong),
  //                    5 = terrible for offense (defense matched).
  it("SR vs SR (defense matched) is quality 5 — worst for offense", () => {
    expect(matchupQuality("SR", "SR")).toBe(5);
  });

  it("SP vs SP (defense matched) is quality 5 — worst for offense", () => {
    expect(matchupQuality("SP", "SP")).toBe(5);
  });

  it("LR vs SP (defense way off) is quality 1 — best for offense", () => {
    expect(matchupQuality("LR", "SP")).toBe(1);
  });

  it("LP vs SR (defense way off) is quality 1 — best for offense", () => {
    expect(matchupQuality("LP", "SR")).toBe(1);
  });
});

describe("computeYardage", () => {
  it("best matchup (LR/SP, q=1) + King + 10-card = 4 × 10 = 40 yards", () => {
    const r = computeYardage({
      offense: "LR",
      defense: "SP",
      multiplierCard: 0, // King
      yardsCard: 10,
    });
    expect(r.matchupQuality).toBe(1);
    expect(r.multiplier).toBe(4);
    expect(r.yardsGained).toBe(40);
  });

  it("defense-matched (SR/SR, q=5) + 10 + 10-card = -1 × 10 = -10 yards", () => {
    const r = computeYardage({
      offense: "SR",
      defense: "SR",
      multiplierCard: 3, // 10
      yardsCard: 10,
    });
    expect(r.matchupQuality).toBe(5);
    expect(r.multiplier).toBe(-1);
    expect(r.yardsGained).toBe(-10);
  });

  it("Jack + quality 3 = 0.5 × 6 = 3 yards (rounding sanity)", () => {
    // SR vs LR = 3, SR vs SP = 3 — both quality 3.
    const r = computeYardage({
      offense: "SR",
      defense: "LR",
      multiplierCard: 2, // Jack
      yardsCard: 6,
    });
    expect(r.matchupQuality).toBe(3);
    expect(r.multiplier).toBe(0.5);
    expect(r.yardsGained).toBe(3);
  });

  it("applies bonus yards (Trick Play overlay) on top of base formula", () => {
    const r = computeYardage({
      offense: "LR",
      defense: "SP",
      multiplierCard: 1, // Queen
      yardsCard: 5,
      bonus: 5,
    });
    // Queen × q=1 = 3; 3*5 + 5 = 20
    expect(r.yardsGained).toBe(20);
  });

  it("rounds 0.5 × odd-yards-card to nearest integer", () => {
    // 0.5 × 7 = 3.5 → Math.round = 4
    const r = computeYardage({
      offense: "SR",
      defense: "LR",
      multiplierCard: 2, // Jack
      yardsCard: 7,
    });
    expect(r.yardsGained).toBe(4);
  });

  // Special-play porting roadmap:
  it.todo("Trick Play die outcomes (LR+5, LP+5, 4x mult, -3x mult, 15yd pen, big play)");
  it.todo("Hail Mary die outcomes (0, 20, 40, TD, sack -10, INT)");
  it.todo("Same Play coin → multiplier card → outcome chain");
  it.todo("Big Play offense odds (1/2 25yd, 1/3 40yd, 1/6 TD)");
  it.todo("Big Play defense odds (1/2 10yd pen, 1/3 turnover+25, 1/6 def TD)");
});
