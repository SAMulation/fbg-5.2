/**
 * Outcome-table helpers. These are the pure lookup functions consumers
 * use when they want the rule outcome without running the state transition.
 */

import { describe, expect, it } from "vitest";
import {
  bigPlayOutcome,
  samePlayOutcome,
  trickPlayOutcome,
} from "../rules/specials/outcomes.js";

describe("samePlayOutcome", () => {
  it("King → Big Play, offense benefits on heads", () => {
    expect(samePlayOutcome("King", "heads")).toEqual({ kind: "big_play", beneficiary: "offense" });
    expect(samePlayOutcome("King", "tails")).toEqual({ kind: "big_play", beneficiary: "defense" });
  });

  it("Queen + heads → +3x, draws yards", () => {
    expect(samePlayOutcome("Queen", "heads")).toEqual({ kind: "multiplier", value: 3, drawYards: true });
  });

  it("Queen + tails → 0x, no yards", () => {
    expect(samePlayOutcome("Queen", "tails")).toEqual({ kind: "multiplier", value: 0, drawYards: false });
  });

  it("Jack + heads → 0x, no yards", () => {
    expect(samePlayOutcome("Jack", "heads")).toEqual({ kind: "multiplier", value: 0, drawYards: false });
  });

  it("Jack + tails → -3x, draws yards", () => {
    expect(samePlayOutcome("Jack", "tails")).toEqual({ kind: "multiplier", value: -3, drawYards: true });
  });

  it("10 + heads → interception", () => {
    expect(samePlayOutcome("10", "heads")).toEqual({ kind: "interception" });
  });

  it("10 + tails → no_gain", () => {
    expect(samePlayOutcome("10", "tails")).toEqual({ kind: "no_gain" });
  });
});

describe("trickPlayOutcome (offensive caller)", () => {
  it("die=1 → LP overlay, +5 bonus", () => {
    expect(trickPlayOutcome(1, 1, 1)).toEqual({ kind: "overlay", play: "LP", bonus: 5 });
  });
  it("die=2 → penalty on defense (offense gains 15)", () => {
    expect(trickPlayOutcome(1, 1, 2)).toEqual({ kind: "penalty", rawYards: 15 });
  });
  it("die=3 → -3x multiplier", () => {
    expect(trickPlayOutcome(1, 1, 3)).toEqual({ kind: "multiplier", value: -3 });
  });
  it("die=4 → +4x multiplier", () => {
    expect(trickPlayOutcome(1, 1, 4)).toEqual({ kind: "multiplier", value: 4 });
  });
  it("die=5 → Big Play for offense", () => {
    expect(trickPlayOutcome(1, 1, 5)).toEqual({ kind: "big_play", beneficiary: 1 });
  });
  it("die=6 → LR overlay, +5 bonus", () => {
    expect(trickPlayOutcome(1, 1, 6)).toEqual({ kind: "overlay", play: "LR", bonus: 5 });
  });
});

describe("trickPlayOutcome (defensive caller)", () => {
  it("die=1 → LP overlay, -5 bonus (signs flip)", () => {
    expect(trickPlayOutcome(2, 1, 1)).toEqual({ kind: "overlay", play: "LP", bonus: -5 });
  });
  it("die=2 → penalty on offense (offense loses 15)", () => {
    expect(trickPlayOutcome(2, 1, 2)).toEqual({ kind: "penalty", rawYards: -15 });
  });
  it("die=5 → Big Play for defense", () => {
    expect(trickPlayOutcome(2, 1, 5)).toEqual({ kind: "big_play", beneficiary: 2 });
  });
});

describe("bigPlayOutcome (offense beneficiary)", () => {
  it("die 1-3 → +25 yards", () => {
    for (const d of [1, 2, 3] as const) {
      expect(bigPlayOutcome(1, 1, d, 50)).toEqual({ kind: "offense_gain", yards: 25 });
    }
  });
  it("die 4-5 from midfield → +40 (40 > half-to-goal 25)", () => {
    expect(bigPlayOutcome(1, 1, 4, 50)).toEqual({ kind: "offense_gain", yards: 40 });
  });
  it("die 4-5 from own 10 → half-to-goal 45", () => {
    expect(bigPlayOutcome(1, 1, 4, 10)).toEqual({ kind: "offense_gain", yards: 45 });
  });
  it("die 6 → TD", () => {
    expect(bigPlayOutcome(1, 1, 6, 50)).toEqual({ kind: "offense_td" });
  });
});

describe("bigPlayOutcome (defense beneficiary)", () => {
  it("die 1-3 → 10-yard penalty on offense", () => {
    expect(bigPlayOutcome(2, 1, 1, 50)).toEqual({ kind: "defense_penalty", rawYards: -10 });
  });
  it("die 1-3 near own goal → half-to-goal cap", () => {
    expect(bigPlayOutcome(2, 1, 1, 8)).toEqual({ kind: "defense_penalty", rawYards: -4 });
  });
  it("die 4-5 → fumble return, max(half, 25)", () => {
    expect(bigPlayOutcome(2, 1, 4, 50)).toEqual({ kind: "defense_fumble_return", yards: 25 });
    expect(bigPlayOutcome(2, 1, 4, 10)).toEqual({ kind: "defense_fumble_return", yards: 45 });
  });
  it("die 6 → defensive TD", () => {
    expect(bigPlayOutcome(2, 1, 6, 50)).toEqual({ kind: "defense_fumble_td" });
  });
});
