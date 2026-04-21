/**
 * Special-play resolution tests. Each special should be exhaustively tested
 * by hand-rolling each die outcome.
 */

import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const startingState = (): GameState => {
  const s = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...s,
    phase: "REG_PLAY",
    field: { ballOn: 50, firstDownAt: 60, down: 1, offense: 1 },
  };
};

/** Force the next d6 roll to a specific value, so each Hail Mary outcome is tested. */
const forcedRng = (d6: 1 | 2 | 3 | 4 | 5 | 6): Rng => ({
  intBetween: () => 0,
  coinFlip: () => "heads",
  d6: () => d6,
});

const playHailMary = (s: GameState, rng: Rng) => {
  const r1 = reduce(s, { type: "PICK_PLAY", player: 1, play: "HM" }, rng);
  return reduce(r1.state, { type: "PICK_PLAY", player: 2, play: "SR" }, rng);
};

describe("Hail Mary outcomes", () => {
  it("die=1 → -10 yards (Big Sack)", () => {
    const s = startingState();
    const { state, events } = playHailMary(s, forcedRng(1));
    expect(events.find((e) => e.type === "HAIL_MARY_ROLL")).toBeDefined();
    const resolved = events.find((e) => e.type === "PLAY_RESOLVED");
    expect(resolved && resolved.type === "PLAY_RESOLVED" && resolved.yardsGained).toBe(-10);
    expect(state.field.ballOn).toBe(40);
  });

  it("die=2 → +20 yards", () => {
    const s = startingState();
    const { state } = playHailMary(s, forcedRng(2));
    expect(state.field.ballOn).toBe(70);
  });

  it("die=3 → 0 yards", () => {
    const s = startingState();
    const { state } = playHailMary(s, forcedRng(3));
    expect(state.field.ballOn).toBe(50);
  });

  it("die=4 → +40 yards", () => {
    const s = startingState();
    const { state } = playHailMary(s, forcedRng(4));
    expect(state.field.ballOn).toBe(90);
  });

  it("die=5 → INTERCEPTION, possession flips at the spot", () => {
    const s = startingState();
    const { state, events } = playHailMary(s, forcedRng(5));
    expect(events.some((e) => e.type === "TURNOVER" && e.reason === "interception")).toBe(true);
    expect(state.field.offense).toBe(2);
    expect(state.field.ballOn).toBe(50); // mirrored: 100 - 50 = 50
    expect(state.field.down).toBe(1);
  });

  it("die=6 → TOUCHDOWN, transitions to PAT_CHOICE", () => {
    const s = startingState();
    const { state, events } = playHailMary(s, forcedRng(6));
    expect(events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
    expect(state.phase).toBe("PAT_CHOICE");
    expect(state.players[1].score).toBe(6);
  });

  it("decrements offense's HM count regardless of outcome", () => {
    const s = startingState();
    expect(s.players[1].hand.HM).toBe(3);
    const { state } = playHailMary(s, forcedRng(3));
    expect(state.players[1].hand.HM).toBe(2);
  });

  it("die=4 from the 70 (yields 110) → TOUCHDOWN", () => {
    const s: GameState = {
      ...startingState(),
      field: { ballOn: 70, firstDownAt: 80, down: 1, offense: 1 },
    };
    const { state, events } = playHailMary(s, forcedRng(4));
    expect(events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
    expect(state.phase).toBe("PAT_CHOICE");
  });

  it("die=1 (-10) from the 5 → SAFETY", () => {
    const s: GameState = {
      ...startingState(),
      field: { ballOn: 5, firstDownAt: 15, down: 1, offense: 1 },
    };
    const { state, events } = playHailMary(s, forcedRng(1));
    expect(events.some((e) => e.type === "SAFETY")).toBe(true);
    expect(state.players[2].score).toBe(2);
    expect(state.phase).toBe("KICKOFF");
  });
});
