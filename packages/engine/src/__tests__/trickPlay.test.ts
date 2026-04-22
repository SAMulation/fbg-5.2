/**
 * Trick Play tests.
 */

import { describe, expect, it } from "vitest";
import {
  resolveDefensiveTrickPlay,
  resolveOffensiveTrickPlay,
} from "../rules/specials/trickPlay.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (ballOn = 50, defensePlay: "SR" | "LR" | "SP" | "LP" = "SR"): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "REG_PLAY",
    field: { ballOn, firstDownAt: ballOn + 10, down: 1, offense: 1 },
    pendingPick: { offensePlay: "TP", defensePlay },
  };
};

const sDef = (ballOn = 50, offensePlay: "SR" | "LR" | "SP" | "LP" = "SR"): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "REG_PLAY",
    field: { ballOn, firstDownAt: ballOn + 10, down: 1, offense: 1 },
    pendingPick: { offensePlay, defensePlay: "TP" },
  };
};

const rigRng = (opts: {
  d6: 1 | 2 | 3 | 4 | 5 | 6;
  multCard?: 0 | 1 | 2 | 3;
  yardsCard?: number;
}): Rng => {
  let multReturned = false;
  let yardsReturned = false;
  return {
    intBetween(min, max) {
      if (!multReturned && min === 0 && max === 3) {
        multReturned = true;
        return opts.multCard ?? 0;
      }
      if (!yardsReturned && min === 0 && max === 9) {
        yardsReturned = true;
        return (opts.yardsCard ?? 5) - 1;
      }
      return min;
    },
    coinFlip: () => "heads",
    d6: () => opts.d6,
  };
};

describe("Trick Play (offense calling)", () => {
  it("die=2 → 15-yard gain as penalty on defense", () => {
    const r = resolveOffensiveTrickPlay(s(50), rigRng({ d6: 2 }));
    expect(r.events.some((e) => e.type === "PENALTY" && e.against === 2)).toBe(true);
    expect(r.state.field.ballOn).toBe(65);
    expect(r.state.field.down).toBe(1); // down NOT advanced
  });

  it("die=2 near goal line → half-to-goal cap", () => {
    const r = resolveOffensiveTrickPlay(s(95), rigRng({ d6: 2 }));
    // 95 + 15 > 99 → half-distance = floor(5/2) = 2
    expect(r.state.field.ballOn).toBe(97);
  });

  it("R-25 die=2 penalty past first-down marker → auto 1st down", () => {
    // 2nd & 3 @ own 39: ballOn=39, firstDownAt=42. Penalty +15 → 54.
    // 54 past 42 → first down, down=1, firstDownAt=64.
    const base = s(39);
    const state2: GameState = {
      ...base,
      field: { ballOn: 39, firstDownAt: 42, down: 2, offense: 1 },
    };
    const r = resolveOffensiveTrickPlay(state2, rigRng({ d6: 2 }));
    expect(r.state.field.ballOn).toBe(54);
    expect(r.state.field.down).toBe(1);
    expect(r.state.field.firstDownAt).toBe(64);
    expect(r.events.some((e) => e.type === "FIRST_DOWN")).toBe(true);
  });

  it("R-25 die=2 penalty short of marker → down replays, no FIRST_DOWN", () => {
    // 1st & 20 @ own 30: ballOn=30, firstDownAt=50. Penalty +15 → 45.
    // 45 < 50 → down stays, firstDownAt stays.
    const base = s(30);
    const state2: GameState = {
      ...base,
      field: { ballOn: 30, firstDownAt: 50, down: 1, offense: 1 },
    };
    const r = resolveOffensiveTrickPlay(state2, rigRng({ d6: 2 }));
    expect(r.state.field.ballOn).toBe(45);
    expect(r.state.field.down).toBe(1);
    expect(r.state.field.firstDownAt).toBe(50);
    expect(r.events.some((e) => e.type === "FIRST_DOWN")).toBe(false);
  });

  it("die=3 → fixed -3x multiplier, yards card draw", () => {
    const r = resolveOffensiveTrickPlay(s(50), rigRng({ d6: 3, yardsCard: 4 }));
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.multiplier.value).toBe(-3);
    expect(r.state.field.ballOn).toBe(38); // 50 + round(-3 * 4)
  });

  it("die=4 → fixed +4x multiplier, yards card draw", () => {
    const r = resolveOffensiveTrickPlay(s(50), rigRng({ d6: 4, yardsCard: 5 }));
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.multiplier.value).toBe(4);
    expect(r.state.field.ballOn).toBe(70);
  });

  it("die=5 → triggers Big Play for offense", () => {
    const r = resolveOffensiveTrickPlay(s(50), rigRng({ d6: 5 }));
    expect(r.events.some((e) => e.type === "BIG_PLAY" && e.beneficiary === 1)).toBe(true);
  });

  it("die=1 → LP + 5 bonus, full matchup against defense's pick", () => {
    // LP vs SR = quality 1 (best). With King (idx 0) mult=4, yards=5 → 20 + 5 bonus = 25.
    const r = resolveOffensiveTrickPlay(
      s(50, "SR"),
      rigRng({ d6: 1, multCard: 0, yardsCard: 5 }),
    );
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.offensePlay).toBe("LP");
    // quality 1 + King = 4x, 4*5 + 5 = 25
    expect(r.state.field.ballOn).toBe(75);
  });

  it("die=6 → LR + 5 bonus", () => {
    // LR vs SP = quality 1. With King mult 4, yards 3 → 12 + 5 = 17.
    const r = resolveOffensiveTrickPlay(
      s(50, "SP"),
      rigRng({ d6: 6, multCard: 0, yardsCard: 3 }),
    );
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.offensePlay).toBe("LR");
    expect(r.state.field.ballOn).toBe(67);
  });
});

describe("Trick Play (defense calling)", () => {
  it("die=2 → 15-yard penalty against offense", () => {
    const r = resolveDefensiveTrickPlay(sDef(50), rigRng({ d6: 2 }));
    expect(r.events.some((e) => e.type === "PENALTY" && e.against === 1)).toBe(true);
    expect(r.state.field.ballOn).toBe(35);
    expect(r.state.field.down).toBe(1); // no down consumed
  });

  it("die=2 deep in own territory → half-to-goal cap", () => {
    const r = resolveDefensiveTrickPlay(sDef(8), rigRng({ d6: 2 }));
    // 8 - 15 < 1 → half-to-goal: -trunc(8/2) = -4. ballOn = 8 - 4 = 4
    expect(r.state.field.ballOn).toBe(4);
  });

  it("die=5 → Big Play for defense", () => {
    const r = resolveDefensiveTrickPlay(sDef(50), rigRng({ d6: 5 }));
    expect(r.events.some((e) => e.type === "BIG_PLAY" && e.beneficiary === 2)).toBe(true);
  });

  it("die=1 → defense's pick becomes LP, -5 bonus to offense", () => {
    // OFF SR vs DEF LP (overlay) = quality 2. King mult = 3. yards 5 → 15 - 5 = 10.
    const r = resolveDefensiveTrickPlay(
      sDef(50, "SR"),
      rigRng({ d6: 1, multCard: 0, yardsCard: 5 }),
    );
    const resolved = r.events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.defensePlay).toBe("LP");
    expect(r.state.field.ballOn).toBe(60);
  });
});
