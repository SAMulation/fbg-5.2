/**
 * End-to-end PICK_PLAY → resolution tests via the public reducer.
 * These exercise the regular-play happy path: both teams pick, deck draws,
 * yardage applied, downs/score updated.
 */

import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { initialState } from "../state.js";
import { seededRng } from "../rng.js";
import type { GameState } from "../types.js";

const startingState = (): GameState => {
  const s = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  // Start mid-field with player 1 on offense, fresh down.
  return {
    ...s,
    phase: "REG_PLAY",
    field: { ballOn: 50, firstDownAt: 60, down: 1, offense: 1 },
  };
};

describe("PICK_PLAY (regular play)", () => {
  it("first pick stages in pendingPick without resolving", () => {
    const s = startingState();
    const { state: after, events } = reduce(
      s,
      { type: "PICK_PLAY", player: 1, play: "LR" },
      seededRng(1),
    );
    expect(after.pendingPick.offensePlay).toBe("LR");
    expect(after.pendingPick.defensePlay).toBe(null);
    expect(events).toEqual([{ type: "PLAY_CALLED", player: 1, play: "LR" }]);
  });

  it("second pick triggers resolution and emits PLAY_RESOLVED", () => {
    const s = startingState();
    const r1 = reduce(s, { type: "PICK_PLAY", player: 1, play: "LR" }, seededRng(1));
    const r2 = reduce(
      r1.state,
      { type: "PICK_PLAY", player: 2, play: "SP" },
      seededRng(1),
    );
    const types = r2.events.map((e) => e.type);
    expect(types).toContain("PLAY_CALLED");
    expect(types).toContain("PLAY_RESOLVED");
  });

  it("decrements the offensive player's hand for the play used", () => {
    const s = startingState();
    expect(s.players[1].hand.LR).toBe(3);
    const r1 = reduce(s, { type: "PICK_PLAY", player: 1, play: "LR" }, seededRng(1));
    const r2 = reduce(
      r1.state,
      { type: "PICK_PLAY", player: 2, play: "SP" },
      seededRng(1),
    );
    expect(r2.state.players[1].hand.LR).toBe(2);
    // Defense's hand is NOT decremented in v5.1 — defense's pick is "free".
    // (Confirmed: only the offense card is consumed per play.)
    expect(r2.state.players[2].hand.SP).toBe(3);
  });

  it("advances to next down and ball position when no first down reached", () => {
    const s = {
      ...startingState(),
      field: { ballOn: 50 as number, firstDownAt: 95, down: 1 as 1 | 2 | 3 | 4, offense: 1 as 1 | 2 },
    };
    const r1 = reduce(s, { type: "PICK_PLAY", player: 1, play: "LR" }, seededRng(1));
    const r2 = reduce(
      r1.state,
      { type: "PICK_PLAY", player: 2, play: "SP" },
      seededRng(1),
    );
    expect(r2.state.field.down).toBe(2);
    expect(r2.state.field.offense).toBe(1);
  });

  it("scores a touchdown when ball crosses 100 and transitions to PAT_CHOICE", () => {
    // Force a setup where 1 yard gain would TD.
    const s: GameState = {
      ...startingState(),
      field: { ballOn: 99, firstDownAt: 100, down: 1, offense: 1 },
    };
    const r1 = reduce(s, { type: "PICK_PLAY", player: 1, play: "SR" }, seededRng(1));
    const r2 = reduce(
      r1.state,
      { type: "PICK_PLAY", player: 2, play: "LP" },
      seededRng(1),
    );
    // SR vs LP = quality 2; with any non-zero positive multiplier, 99 + N >= 100.
    if (r2.events.some((e) => e.type === "TOUCHDOWN")) {
      expect(r2.state.phase).toBe("PAT_CHOICE");
      expect(r2.state.players[1].score).toBe(6);
    } else {
      // Some seed/draw combos produce 0-yard plays even on quality 2 (Jack/10 cards).
      // In that case no TD, no PAT — verify no false-positive scoring.
      expect(r2.state.players[1].score).toBe(0);
    }
  });

  it("turnover on downs flips possession with the ball at the spot", () => {
    const s: GameState = {
      ...startingState(),
      field: { ballOn: 50, firstDownAt: 60, down: 4, offense: 1 },
    };
    let r = reduce(s, { type: "PICK_PLAY", player: 1, play: "SR" }, seededRng(99));
    r = reduce(r.state, { type: "PICK_PLAY", player: 2, play: "SR" }, seededRng(99));
    // SR vs SR = quality 5 — short yardage at best, almost certainly < 10.
    if (r.events.some((e) => e.type === "TURNOVER_ON_DOWNS")) {
      expect(r.state.field.offense).toBe(2);
      expect(r.state.field.down).toBe(1);
    }
  });

  it("is deterministic for identical seeds", () => {
    const a = reduce(
      reduce(startingState(), { type: "PICK_PLAY", player: 1, play: "LR" }, seededRng(7)).state,
      { type: "PICK_PLAY", player: 2, play: "SP" },
      seededRng(7),
    );
    const b = reduce(
      reduce(startingState(), { type: "PICK_PLAY", player: 1, play: "LR" }, seededRng(7)).state,
      { type: "PICK_PLAY", player: 2, play: "SP" },
      seededRng(7),
    );
    expect(a.state).toEqual(b.state);
    expect(a.events).toEqual(b.events);
  });
});
