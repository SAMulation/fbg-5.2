/**
 * Big Play tests — exhaustively hand-rolls each die outcome for both
 * offense and defense beneficiary.
 */

import { describe, expect, it } from "vitest";
import { resolveBigPlay } from "../rules/specials/bigPlay.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (ballOn = 50, firstDownAt = 60, down: 1 | 2 | 3 | 4 = 1): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "REG_PLAY",
    field: { ballOn, firstDownAt, down, offense: 1 },
  };
};

const forcedRng = (d6: 1 | 2 | 3 | 4 | 5 | 6): Rng => ({
  intBetween: (min, max) => min + Math.floor((max - min) / 2),
  coinFlip: () => "heads",
  d6: () => d6,
});

describe("Big Play (offense beneficiary)", () => {
  it("die 1-3 → +25 yards", () => {
    for (const die of [1, 2, 3] as const) {
      const r = resolveBigPlay(s(50), 1, forcedRng(die));
      expect(r.state.field.ballOn).toBe(75);
    }
  });

  it("die 6 → touchdown", () => {
    const r = resolveBigPlay(s(50), 1, forcedRng(6));
    expect(r.events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
    expect(r.state.phase).toBe("PAT_CHOICE");
    expect(r.state.players[1].score).toBe(6);
  });

  it("die 4-5 from midfield → +40 (40 > half-to-goal 25)", () => {
    for (const die of [4, 5] as const) {
      const r = resolveBigPlay(s(50), 1, forcedRng(die));
      expect(r.state.field.ballOn).toBe(90);
    }
  });

  it("die 4-5 from own 10 → half-to-goal (45) since that > 40", () => {
    const r = resolveBigPlay(s(10), 1, forcedRng(4));
    // half-to-goal from 10 = (100-10)/2 = 45
    expect(r.state.field.ballOn).toBe(55);
  });

  it("die 1-3 from 99-yard line → TD (crosses goal)", () => {
    const r = resolveBigPlay(s(99), 1, forcedRng(1));
    expect(r.events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
  });

  it("marks FIRST_DOWN when gain crosses the sticks", () => {
    const r = resolveBigPlay(s(50, 60), 1, forcedRng(1)); // +25 → 75, first down
    expect(r.events.some((e) => e.type === "FIRST_DOWN")).toBe(true);
    expect(r.state.field.down).toBe(1);
    expect(r.state.field.firstDownAt).toBe(85);
  });
});

describe("Big Play (defense beneficiary)", () => {
  it("die 1-3 → 10-yard penalty on offense, repeat down (no down consumed)", () => {
    const r = resolveBigPlay(s(50, 60, 2), 2, forcedRng(1));
    expect(r.events.some((e) => e.type === "PENALTY")).toBe(true);
    expect(r.state.field.ballOn).toBe(40);
    expect(r.state.field.down).toBe(2); // down NOT advanced
    expect(r.state.field.offense).toBe(1); // possession retained
  });

  it("die 1-3 deep in own territory → half-to-goal", () => {
    const r = resolveBigPlay(s(8, 18, 1), 2, forcedRng(2));
    // 8 - 10 = -2, so half to goal: floor(8/2) = 4. ballOn = 8 - 4 = 4
    expect(r.state.field.ballOn).toBe(4);
  });

  it("die 4-5 → turnover, defense returns to half-the-field-or-25", () => {
    const r = resolveBigPlay(s(50, 60, 2), 2, forcedRng(4));
    expect(r.events.some((e) => e.type === "TURNOVER")).toBe(true);
    expect(r.state.field.offense).toBe(2); // possession flipped
    // F-50: defender starts at (100 - ballOn) = 50 in own POV, returns
    // max(half=25, 25) = 25 forward → final ballOn = 75 (red-zone field
    // position for the new offense).
    expect(r.state.field.ballOn).toBe(75);
  });

  it("die 6 → defensive TD", () => {
    const r = resolveBigPlay(s(50), 2, forcedRng(6));
    const types = r.events.map((e) => e.type);
    expect(types).toContain("TURNOVER");
    expect(types).toContain("TOUCHDOWN");
    expect(r.state.players[2].score).toBe(6);
    expect(r.state.phase).toBe("PAT_CHOICE");
    expect(r.state.field.offense).toBe(2); // kicking team for PAT
  });

  it("die 4-5 fumble in own deep territory → defensive TD return", () => {
    // F-50: offense at own 10 fumbles. Defender starts at (100-10)=90 in own
    // POV, returns max(half=45, 25) = 45. Final = 90 + 45 = 135 → TD for defender.
    const r = resolveBigPlay(s(10), 2, forcedRng(4));
    const types = r.events.map((e) => e.type);
    expect(types).toContain("TURNOVER");
    expect(types).toContain("TOUCHDOWN");
    expect(r.state.players[2].score).toBe(6);
    expect(r.state.phase).toBe("PAT_CHOICE");
  });

  it("die 4-5 fumble from offense's red zone → defender pinned deep in own end", () => {
    // F-50: offense at own 80 (deep red zone) fumbles. Defender starts at
    // (100-80)=20, returns max(half=10, 25) = 25 → defender at 45 in own POV.
    const r = resolveBigPlay(s(80), 2, forcedRng(4));
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(45);
  });
});
