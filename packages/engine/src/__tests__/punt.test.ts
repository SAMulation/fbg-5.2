/**
 * Punt tests. Block & muff checks need 2-sixes in a row — the d6 mock
 * has to be sequenced to test those.
 */

import { describe, expect, it } from "vitest";
import { resolvePunt } from "../rules/specials/punt.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (ballOn = 30): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "REG_PLAY",
    field: { ballOn, firstDownAt: ballOn + 10, down: 4, offense: 1 },
  };
};

interface RngSeq {
  d6?: (1 | 2 | 3 | 4 | 5 | 6)[];
  coins?: ("heads" | "tails")[];
  yardsCards?: number[]; // 1-10
  multCards?: (0 | 1 | 2 | 3)[];
}

const seqRng = (seq: RngSeq): Rng => {
  const d6Queue = [...(seq.d6 ?? [])];
  const coinQueue = [...(seq.coins ?? [])];
  const yardsQueue = [...(seq.yardsCards ?? [])];
  const multQueue = [...(seq.multCards ?? [])];
  return {
    d6: () => (d6Queue.shift() ?? 1) as 1 | 2 | 3 | 4 | 5 | 6,
    coinFlip: () => coinQueue.shift() ?? "heads",
    intBetween(min, max) {
      if (min === 0 && max === 3) return (multQueue.shift() ?? 0) as number;
      if (min === 0 && max === 9) return ((yardsQueue.shift() ?? 5) - 1);
      return min;
    },
  };
};

describe("Punt", () => {
  it("happy path: 50-yard punt, receiver catches, short return", () => {
    const r = resolvePunt(
      s(30),
      seqRng({
        d6: [3, 1], // no block (first d6 != 6); no muff (first d6 != 6)
        coins: ["heads"], // +20 kick bonus
        yardsCards: [6, 2], // kick: 10*6/2 + 20 = 50; return: mult * 2
        multCards: [2], // Jack return = 1x; return = 1 * 2 = 2
      }),
    );
    expect(r.events.some((e) => e.type === "PUNT")).toBe(true);
    // Kick from 30 goes 50 yards → lands at 80.
    // Receiver's POV: 100 - 80 = 20, plus return 2 = 22.
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(22);
  });

  it("touchback: punt lands past goal → receiver gets ball at 20", () => {
    const r = resolvePunt(
      s(60),
      seqRng({
        d6: [3], // no block (muff check skipped on touchback)
        coins: ["heads"],
        yardsCards: [10], // 10*10/2 + 20 = 70 → lands at 130 > 100
      }),
    );
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(20);
    expect(r.state.field.firstDownAt).toBe(30);
  });

  it("blocked punt (2 sixes) → turnover at line of scrimmage", () => {
    const r = resolvePunt(
      s(40),
      seqRng({
        d6: [6, 6], // block!
      }),
    );
    expect(r.events.some((e) => e.type === "TURNOVER")).toBe(true);
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(60); // mirrored 40
  });

  it("muffed punt (2 sixes after catch) → kicking team recovers at landing", () => {
    const r = resolvePunt(
      s(30),
      seqRng({
        d6: [3, 6, 6], // no block, then muff check: 2 sixes
        coins: ["tails"],
        yardsCards: [4], // kick: 10*4/2 + 0 = 20 → lands at 50
      }),
    );
    expect(r.events.some((e) => e.type === "TURNOVER" && e.reason === "fumble")).toBe(true);
    expect(r.state.field.offense).toBe(1); // kicker retains
    expect(r.state.field.ballOn).toBe(50);
  });

  it("safety kick skips block and muff checks", () => {
    const r = resolvePunt(
      s(35),
      seqRng({
        d6: [6, 6], // would block on normal punt, but not on safety kick
        coins: ["heads"],
        yardsCards: [6, 1],
        multCards: [2], // Jack return = 1 * 1 = 1
      }),
      { safetyKick: true },
    );
    // 10*6/2 + 20 = 50 → lands at 85. Return from 100-85=15 + 1 = 16.
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(16);
  });
});
