/**
 * Same Play tests. Two coin flips are in play — one for the Same Play
 * mechanism trigger (reducer-level), one for the coin inside samePlay.
 * Tests here target the samePlay resolver directly, so they only care
 * about the inner coin.
 */

import { describe, expect, it } from "vitest";
import { resolveSamePlay } from "../rules/specials/samePlay.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";
import type { MultiplierCardIndex } from "../rules/yardage.js";

const s = (ballOn = 50): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "REG_PLAY",
    field: { ballOn, firstDownAt: ballOn + 10, down: 1, offense: 1 },
    pendingPick: { offensePlay: "SR", defensePlay: "SR" },
  };
};

/** Force multiplier card draw and coin flip. */
const rigRng = (opts: {
  multCard: MultiplierCardIndex;
  coin?: "heads" | "tails";
  d6?: 1 | 2 | 3 | 4 | 5 | 6;
  yardsCard?: number;
}): Rng => {
  // drawMultiplier loops rng.intBetween(0,3) rejecting empty slots — a fresh
  // deck has all slots non-empty, so the first draw returns our forced value.
  let multReturned = false;
  let yardsReturned = false;
  return {
    intBetween(min, max) {
      if (!multReturned && min === 0 && max === 3) {
        multReturned = true;
        return opts.multCard;
      }
      if (!yardsReturned && min === 0 && max === 9) {
        yardsReturned = true;
        return (opts.yardsCard ?? 5) - 1;
      }
      // Default for FG's rarely-hit intBetween(1, 1000) etc.
      return min;
    },
    coinFlip: () => opts.coin ?? "heads",
    d6: () => opts.d6 ?? 1,
  };
};

describe("Same Play outcomes", () => {
  it("Queen + heads → +3x multiplier with yards draw", () => {
    const r = resolveSamePlay(s(50), rigRng({ multCard: 1, coin: "heads", yardsCard: 5 }));
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.multiplier.value).toBe(3);
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.yardsGained).toBe(15);
    expect(r.state.field.ballOn).toBe(65);
  });

  it("Queen + tails → 0 yards", () => {
    const r = resolveSamePlay(s(50), rigRng({ multCard: 1, coin: "tails" }));
    expect(r.state.field.ballOn).toBe(50);
    expect(r.state.field.down).toBe(2); // down consumed
  });

  it("Jack + heads → 0 yards", () => {
    const r = resolveSamePlay(s(50), rigRng({ multCard: 2, coin: "heads" }));
    expect(r.state.field.ballOn).toBe(50);
    expect(r.state.field.down).toBe(2);
  });

  it("Jack + tails → -3x multiplier with yards draw", () => {
    const r = resolveSamePlay(s(50), rigRng({ multCard: 2, coin: "tails", yardsCard: 4 }));
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.multiplier.value).toBe(-3);
    expect(r.state.field.ballOn).toBe(38); // 50 - 12
  });

  it("10 + heads → INTERCEPTION (turnover at mirrored spot)", () => {
    const r = resolveSamePlay(s(50), rigRng({ multCard: 3, coin: "heads" }));
    expect(r.events.some((e) => e.type === "TURNOVER" && e.reason === "interception")).toBe(true);
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(50);
  });

  it("10 + tails → 0 yards", () => {
    const r = resolveSamePlay(s(50), rigRng({ multCard: 3, coin: "tails" }));
    expect(r.state.field.ballOn).toBe(50);
    expect(r.state.field.offense).toBe(1);
  });

  it("King + heads → Big Play for offense", () => {
    const r = resolveSamePlay(
      s(50),
      rigRng({ multCard: 0, coin: "heads", d6: 1 }),
    );
    expect(r.events.some((e) => e.type === "BIG_PLAY" && e.beneficiary === 1)).toBe(true);
  });

  it("King + tails → Big Play for defense", () => {
    const r = resolveSamePlay(
      s(50),
      rigRng({ multCard: 0, coin: "tails", d6: 1 }),
    );
    expect(r.events.some((e) => e.type === "BIG_PLAY" && e.beneficiary === 2)).toBe(true);
  });
});
