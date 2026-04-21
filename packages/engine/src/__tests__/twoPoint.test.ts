import { describe, expect, it } from "vitest";
import { resolveTwoPointConversion } from "../rules/specials/twoPoint.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "TWO_PT_CONV",
    field: { ballOn: 97, firstDownAt: 100, down: 1, offense: 1 },
  };
};

const rigRng = (multCard: 0 | 1 | 2 | 3, yardsCard: number): Rng => {
  let multReturned = false;
  let yardsReturned = false;
  return {
    intBetween(min, max) {
      if (!multReturned && min === 0 && max === 3) {
        multReturned = true;
        return multCard;
      }
      if (!yardsReturned && min === 0 && max === 9) {
        yardsReturned = true;
        return yardsCard - 1;
      }
      return min;
    },
    coinFlip: () => "heads",
    d6: () => 1,
  };
};

describe("Two-Point Conversion", () => {
  it("play gains enough to cross goal → TWO_POINT_GOOD, +2 points, KICKOFF", () => {
    // LR vs SP = quality 1 (best). King mult = 4. yards 1 → 4 yards. 97+4 = 101 ≥ 100.
    const r = resolveTwoPointConversion(s(), "LR", "SP", rigRng(0, 1));
    expect(r.events.some((e) => e.type === "TWO_POINT_GOOD")).toBe(true);
    expect(r.state.players[1].score).toBe(2);
    expect(r.state.phase).toBe("KICKOFF");
  });

  it("play fails to cross goal → TWO_POINT_FAILED, no points, KICKOFF", () => {
    // SR vs SR = quality 5 (worst). 10 card = -1x. yards 1 → -1. 97-1 = 96.
    const r = resolveTwoPointConversion(s(), "SR", "SR", rigRng(3, 1));
    expect(r.events.some((e) => e.type === "TWO_POINT_FAILED")).toBe(true);
    expect(r.state.players[1].score).toBe(0);
    expect(r.state.phase).toBe("KICKOFF");
  });
});
