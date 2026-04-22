import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { resolveTwoPointConversion } from "../rules/specials/twoPoint.js";
import { initialState } from "../state.js";
import { seededRng } from "../rng.js";
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

describe("Two-Point Conversion — PICK_PLAY routing (regression)", () => {
  it("offense picks TP during TWO_PT_CONV → coerced to SR, resolves as 2-pt, no phantom TOUCHDOWN", () => {
    // Prior bug: TP on 2-pt fell through to resolveOffensiveTrickPlay, which
    // could emit TOUCHDOWN + transition to PAT_CHOICE for a 6-pt mis-score.
    const base = s();
    // Offense picks TP first, defense picks SR second.
    const r1 = reduce(base, { type: "PICK_PLAY", player: 1, play: "TP" }, seededRng(1));
    const r2 = reduce(r1.state, { type: "PICK_PLAY", player: 2, play: "SR" }, seededRng(2));

    // Must end in KICKOFF (2-pt terminal), never PAT_CHOICE.
    expect(r2.state.phase).toBe("KICKOFF");
    // Must emit a TWO_POINT_* event, never TOUCHDOWN.
    const types = r2.events.map((e) => e.type);
    expect(types).not.toContain("TOUCHDOWN");
    expect(
      types.includes("TWO_POINT_GOOD") || types.includes("TWO_POINT_FAILED"),
    ).toBe(true);
    // Score must be 0 or 2 — never 6 or 7.
    expect([0, 2]).toContain(r2.state.players[1].score);
  });

  it("offense picks HM during TWO_PT_CONV → coerced, resolves as 2-pt", () => {
    const base = s();
    const r1 = reduce(base, { type: "PICK_PLAY", player: 1, play: "HM" }, seededRng(3));
    const r2 = reduce(r1.state, { type: "PICK_PLAY", player: 2, play: "SR" }, seededRng(4));

    expect(r2.state.phase).toBe("KICKOFF");
    const types = r2.events.map((e) => e.type);
    expect(types).not.toContain("TOUCHDOWN");
    expect(
      types.includes("TWO_POINT_GOOD") || types.includes("TWO_POINT_FAILED"),
    ).toBe(true);
  });

  it("defense picks TP during TWO_PT_CONV → coerced to SR, resolves as 2-pt", () => {
    const base = s();
    const r1 = reduce(base, { type: "PICK_PLAY", player: 1, play: "LR" }, seededRng(5));
    const r2 = reduce(r1.state, { type: "PICK_PLAY", player: 2, play: "TP" }, seededRng(6));

    expect(r2.state.phase).toBe("KICKOFF");
    const types = r2.events.map((e) => e.type);
    expect(types).not.toContain("TOUCHDOWN");
    expect(
      types.includes("TWO_POINT_GOOD") || types.includes("TWO_POINT_FAILED"),
    ).toBe(true);
  });
});
