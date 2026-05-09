import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { initialState } from "../state.js";
import { seededRng } from "../rng.js";
import type { GameState, PenaltyDescriptor } from "../types.js";

/**
 * Penalty framework tests — exercise the PENALTY_CHOICE phase and the
 * ACCEPT_PENALTY / DECLINE_PENALTY actions. These tests construct
 * pendingPenalty + PENALTY_CHOICE state directly because no current
 * resolver opts into the choice path (TP die=2 and BP die=1-3 still
 * auto-apply for backward compatibility).
 */

function baseState(): GameState {
  return initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
}

function withPendingPenalty(pp: PenaltyDescriptor, phase: "REG_PLAY" | "OT_PLAY" = "REG_PLAY"): GameState {
  const base = baseState();
  return {
    ...base,
    phase: "PENALTY_CHOICE",
    overtime: phase === "OT_PLAY" ? { period: 1, possession: 1, firstReceiver: 1, possessionsRemaining: 2 } : null,
    field: {
      ballOn: pp.preState.ballOn,
      firstDownAt: pp.preState.firstDownAt,
      down: pp.preState.down,
      offense: 1,
    },
    pendingPenalty: pp,
  };
}

describe("penalty framework — ACCEPT", () => {
  it("offense beneficiary: applies yards in offense POV", () => {
    const pp: PenaltyDescriptor = {
      against: 2,
      yards: 10,
      lossOfDown: false,
      beneficiary: 1,
      preState: { ballOn: 30, firstDownAt: 50, down: 2 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    const { state: next, events } = reduce(state, { type: "ACCEPT_PENALTY", player: 1 }, seededRng(1));
    expect(next.field.ballOn).toBe(40);
    expect(next.field.down).toBe(2); // didn't cross firstDownAt 50
    expect(next.field.firstDownAt).toBe(50); // unchanged
    expect(next.phase).toBe("REG_PLAY");
    expect(next.pendingPenalty).toBeNull();
    expect(events).toEqual([]);
  });

  it("R-25: offense penalty crossing first-down marker → automatic first down", () => {
    const pp: PenaltyDescriptor = {
      against: 2,
      yards: 15,
      lossOfDown: false,
      beneficiary: 1,
      preState: { ballOn: 39, firstDownAt: 42, down: 2 },
      source: "TP_DIE_2",
    };
    const state = withPendingPenalty(pp);
    const { state: next, events } = reduce(state, { type: "ACCEPT_PENALTY", player: 1 }, seededRng(1));
    expect(next.field.ballOn).toBe(54);
    expect(next.field.down).toBe(1);
    expect(next.field.firstDownAt).toBe(64); // 54 + 10
    expect(events.some((e) => e.type === "FIRST_DOWN")).toBe(true);
  });

  it("half-distance-to-goal cap when raw yards would push past goal line", () => {
    const pp: PenaltyDescriptor = {
      against: 2,
      yards: 15,
      lossOfDown: false,
      beneficiary: 1,
      preState: { ballOn: 90, firstDownAt: 100, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    const { state: next } = reduce(state, { type: "ACCEPT_PENALTY", player: 1 }, seededRng(1));
    // (100 - 90)/2 = 5; new ballOn = 95
    expect(next.field.ballOn).toBe(95);
  });

  it("defense beneficiary: applies yards in defense POV (mirror)", () => {
    const pp: PenaltyDescriptor = {
      against: 1,
      yards: 10,
      lossOfDown: false,
      beneficiary: 2,
      preState: { ballOn: 50, firstDownAt: 60, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    const { state: next } = reduce(state, { type: "ACCEPT_PENALTY", player: 2 }, seededRng(1));
    // Defense gains 10 yards toward their own goal in offense POV =
    // ballOn moves backward by 10. 50 - 10 = 40.
    expect(next.field.ballOn).toBe(40);
  });

  it("defense beneficiary: half-distance cap when penalty would push past offense goal", () => {
    const pp: PenaltyDescriptor = {
      against: 1,
      yards: 15,
      lossOfDown: false,
      beneficiary: 2,
      preState: { ballOn: 5, firstDownAt: 15, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    const { state: next } = reduce(state, { type: "ACCEPT_PENALTY", player: 2 }, seededRng(1));
    // 5 - 15 = -10 → cap at trunc(5/2) = 2 yards back. 5 - 2 = 3.
    expect(next.field.ballOn).toBe(3);
  });

  it("R-26: penalty on offense does not reset firstDownAt", () => {
    // Offense was at 1st & 10 @ own 30 (firstDownAt=40). Penalty against
    // them (10 yds back) should leave firstDownAt at 40, not reset.
    const pp: PenaltyDescriptor = {
      against: 1,
      yards: 10,
      lossOfDown: false,
      beneficiary: 2,
      preState: { ballOn: 30, firstDownAt: 40, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    const { state: next } = reduce(state, { type: "ACCEPT_PENALTY", player: 2 }, seededRng(1));
    expect(next.field.ballOn).toBe(20);
    expect(next.field.firstDownAt).toBe(40); // unchanged
    expect(next.field.down).toBe(1); // R-26: same down
  });

  it("loss-of-down: advances down on accept", () => {
    const pp: PenaltyDescriptor = {
      against: 1,
      yards: 5,
      lossOfDown: true,
      beneficiary: 2,
      preState: { ballOn: 30, firstDownAt: 40, down: 2 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    const { state: next } = reduce(state, { type: "ACCEPT_PENALTY", player: 2 }, seededRng(1));
    expect(next.field.down).toBe(3);
  });
});

describe("penalty framework — DECLINE", () => {
  it("returns to play phase without applying yards", () => {
    const pp: PenaltyDescriptor = {
      against: 2,
      yards: 15,
      lossOfDown: false,
      beneficiary: 1,
      preState: { ballOn: 40, firstDownAt: 50, down: 2 },
      source: "TEST",
    };
    // Simulate that the play already ran and resolved to ball@45 before
    // the penalty was flagged for choice. preState is the play's snap.
    const state: GameState = {
      ...withPendingPenalty(pp),
      field: { ballOn: 45, firstDownAt: 50, down: 2, offense: 1 },
    };
    const { state: next, events } = reduce(state, { type: "DECLINE_PENALTY", player: 1 }, seededRng(1));
    // Decline keeps the play's natural outcome.
    expect(next.field.ballOn).toBe(45);
    expect(next.field.down).toBe(2);
    expect(next.phase).toBe("REG_PLAY");
    expect(next.pendingPenalty).toBeNull();
    expect(events).toEqual([]);
  });
});

describe("penalty framework — phase routing", () => {
  it("OT context: ACCEPT returns to OT_PLAY, not REG_PLAY", () => {
    const pp: PenaltyDescriptor = {
      against: 2,
      yards: 5,
      lossOfDown: false,
      beneficiary: 1,
      preState: { ballOn: 25, firstDownAt: 35, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp, "OT_PLAY");
    const { state: next } = reduce(state, { type: "ACCEPT_PENALTY", player: 1 }, seededRng(1));
    expect(next.phase).toBe("OT_PLAY");
  });

  it("OT context: DECLINE returns to OT_PLAY", () => {
    const pp: PenaltyDescriptor = {
      against: 1,
      yards: 5,
      lossOfDown: false,
      beneficiary: 2,
      preState: { ballOn: 25, firstDownAt: 35, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp, "OT_PLAY");
    const { state: next } = reduce(state, { type: "DECLINE_PENALTY", player: 2 }, seededRng(1));
    expect(next.phase).toBe("OT_PLAY");
  });
});

describe("penalty framework — validation", () => {
  it("ACCEPT_PENALTY rejected when not in PENALTY_CHOICE", () => {
    const state = baseState();
    const { state: next, events } = reduce(state, { type: "ACCEPT_PENALTY", player: 1 }, seededRng(1));
    expect(next).toBe(state); // unchanged
    expect(events).toEqual([]);
  });

  it("ACCEPT_PENALTY rejected when wrong player makes the choice", () => {
    const pp: PenaltyDescriptor = {
      against: 1,
      yards: 10,
      lossOfDown: false,
      beneficiary: 2,
      preState: { ballOn: 30, firstDownAt: 40, down: 1 },
      source: "TEST",
    };
    const state = withPendingPenalty(pp);
    // Offense (1) tries to accept a penalty whose beneficiary is defense (2).
    const { state: next, events } = reduce(state, { type: "ACCEPT_PENALTY", player: 1 }, seededRng(1));
    expect(next).toBe(state);
    expect(events).toEqual([]);
  });

  it("DECLINE_PENALTY rejected when no pendingPenalty", () => {
    const base = baseState();
    const state: GameState = { ...base, phase: "PENALTY_CHOICE" };
    const { state: next, events } = reduce(state, { type: "DECLINE_PENALTY", player: 1 }, seededRng(1));
    expect(next).toBe(state);
    expect(events).toEqual([]);
  });
});
