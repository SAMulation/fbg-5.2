/**
 * Field Goal tests. Distance = (100 - ballOn) + 17.
 */

import { describe, expect, it } from "vitest";
import { resolveFieldGoal } from "../rules/specials/fieldGoal.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (ballOn: number): GameState => {
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

const rng = (d6: 1 | 2 | 3 | 4 | 5 | 6, intReturn = 0): Rng => ({
  intBetween: () => intReturn,
  coinFlip: () => "heads",
  d6: () => d6,
});

describe("Field Goal", () => {
  it("chip shot (<20 yds) is automatic regardless of die", () => {
    // 100 - 85 + 17 = 32 ← 30-yard band, need die >= 3
    // Use 85+ to test automatic: 100 - 88 + 17 = 29 → still 20-yard band
    // For auto-make, need distance < 20. 100 - ballOn + 17 < 20 → ballOn > 97.
    const r = resolveFieldGoal(s(98), rng(1));
    expect(r.events.some((e) => e.type === "FIELD_GOAL_GOOD")).toBe(true);
    expect(r.state.players[1].score).toBe(3);
    expect(r.state.phase).toBe("KICKOFF");
  });

  it("50-yard band needs die >= 5", () => {
    // 100 - 67 + 17 = 50
    const missed = resolveFieldGoal(s(67), rng(4));
    expect(missed.events.some((e) => e.type === "FIELD_GOAL_MISSED")).toBe(true);
    expect(missed.state.field.offense).toBe(2); // possession flipped

    const made = resolveFieldGoal(s(67), rng(5));
    expect(made.events.some((e) => e.type === "FIELD_GOAL_GOOD")).toBe(true);
  });

  it("icing modifier adds 1 to the die", () => {
    // 50-yard kick, die=4 would miss, but iced → 5 → makes
    const r = resolveFieldGoal(s(67), rng(4), { iced: true });
    expect(r.events.some((e) => e.type === "FIELD_GOAL_GOOD")).toBe(true);
  });

  it("icing cannot push die above 6", () => {
    const r = resolveFieldGoal(s(67), rng(6), { iced: true });
    expect(r.events.some((e) => e.type === "FIELD_GOAL_GOOD")).toBe(true);
  });

  it("beyond 65 yards is near-impossible (needs rng match)", () => {
    // 100 - 18 + 17 = 99 yards
    const r = resolveFieldGoal(s(18), rng(6, 0)); // intBetween returns 0, not 99
    expect(r.events.some((e) => e.type === "FIELD_GOAL_MISSED")).toBe(true);
  });

  it("miss flips possession at mirror of the kick spot", () => {
    const r = resolveFieldGoal(s(67), rng(1));
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.ballOn).toBe(33); // 100 - 67
    expect(r.state.field.down).toBe(1);
  });

  it("make transitions to KICKOFF phase with +3 score", () => {
    const r = resolveFieldGoal(s(80), rng(6)); // ~37 yds — 30-band, die 6 makes
    expect(r.state.phase).toBe("KICKOFF");
    expect(r.state.players[1].score).toBe(3);
  });
});
