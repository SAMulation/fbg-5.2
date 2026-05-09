/**
 * Determinism / replay tests.
 *
 * The engine promises (rng.ts comment block) that a complete game can be
 * replayed from (seed, actions). Recap playback, bug-report replay, and
 * server-authoritative rehydration all rely on this invariant.
 *
 * This file records a game driven by scripted actions, then replays the
 * same action log with the same RNG construction, and asserts that the
 * final state and event stream match byte-for-byte.
 *
 * If any code path in the engine ever uses Math.random() or Date.now()
 * directly, these tests fail.
 */

import { describe, expect, it } from "vitest";
import { reduce, replayActions } from "../reducer.js";
import { initialState } from "../state.js";
import { seededRng } from "../rng.js";
import type { Action } from "../actions.js";
import type { Event } from "../events.js";
import type { GameState } from "../types.js";

interface Recording {
  finalState: GameState;
  eventLog: Event[][];
}

/**
 * Drive the engine through `actions`, using the same per-action seed
 * construction the Durable Object uses (game-room.ts:197: `seed + i`).
 */
function run(seed: number, actions: Action[]): Recording {
  let state = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  const eventLog: Event[][] = [];
  for (let i = 0; i < actions.length; i++) {
    const rng = seededRng((seed + i) >>> 0);
    const result = reduce(state, actions[i]!, rng);
    state = result.state;
    eventLog.push(result.events);
  }
  return { finalState: state, eventLog };
}

const SHORT_GAME: Action[] = [
  { type: "START_GAME", quarterLengthMinutes: 1, teams: { 1: "NE", 2: "GB" } },
  { type: "COIN_TOSS_CALL", player: 1, call: "heads" },
  { type: "RECEIVE_CHOICE", player: 1, choice: "receive" },
  { type: "RESOLVE_KICKOFF", kickType: "RK", returnType: "RR" },
  { type: "PICK_PLAY", player: 1, play: "LR" },
  { type: "PICK_PLAY", player: 2, play: "SR" },
  { type: "TICK_CLOCK", seconds: 30 },
  { type: "PICK_PLAY", player: 1, play: "SP" },
  { type: "PICK_PLAY", player: 2, play: "LP" },
  { type: "TICK_CLOCK", seconds: 30 },
];

describe("determinism — replay from (seed, actions)", () => {
  it("same seed + same action log → identical final state", () => {
    const a = run(42, SHORT_GAME);
    const b = run(42, SHORT_GAME);
    expect(b.finalState).toEqual(a.finalState);
  });

  it("same seed + same action log → identical event stream", () => {
    const a = run(42, SHORT_GAME);
    const b = run(42, SHORT_GAME);
    expect(b.eventLog).toEqual(a.eventLog);
  });

  it("different seed → different event stream", () => {
    const a = run(42, SHORT_GAME);
    const b = run(43, SHORT_GAME);
    // Some events (START_GAME, RECEIVE_CHOICE transitions) don't depend on
    // RNG and so will still match. We assert divergence somewhere in the
    // stream — specifically in the COIN_TOSS_RESULT or later rolls.
    const coinA = a.eventLog.flat().find((e) => e.type === "COIN_TOSS_RESULT");
    const coinB = b.eventLog.flat().find((e) => e.type === "COIN_TOSS_RESULT");
    const anyDivergence =
      JSON.stringify(a.finalState) !== JSON.stringify(b.finalState) ||
      (coinA && coinB && JSON.stringify(coinA) !== JSON.stringify(coinB));
    expect(anyDivergence).toBe(true);
  });
});

describe("replayActions — server-rehydration helper", () => {
  it("reconstructs the same final state as run()", () => {
    const seed = 12345;
    const ground = run(seed, SHORT_GAME);
    const initial = initialState({
      team1: { id: "NE" },
      team2: { id: "GB" },
      quarterLengthMinutes: 7,
    });
    const replayed = replayActions(initial, SHORT_GAME, seed);
    expect(replayed.state).toEqual(ground.finalState);
  });

  it("flattens the event stream identically to run()", () => {
    const seed = 99;
    const ground = run(seed, SHORT_GAME);
    const initial = initialState({
      team1: { id: "NE" },
      team2: { id: "GB" },
      quarterLengthMinutes: 7,
    });
    const replayed = replayActions(initial, SHORT_GAME, seed);
    expect(replayed.events).toEqual(ground.eventLog.flat());
  });

  it("empty action log returns initial unchanged", () => {
    const initial = initialState({
      team1: { id: "NE" },
      team2: { id: "GB" },
      quarterLengthMinutes: 7,
    });
    const replayed = replayActions(initial, [], 0);
    expect(replayed.state).toBe(initial);
    expect(replayed.events).toEqual([]);
  });
});

describe("determinism — fuzz across many seeds", () => {
  // Property-ish test: for 50 random seeds, replay twice and verify byte
  // equality. Catches any Math.random() / Date.now() sneaking in.
  it("replay byte-equal across 50 seeds", () => {
    for (let s = 1; s <= 50; s++) {
      const a = run(s * 7919, SHORT_GAME);
      const b = run(s * 7919, SHORT_GAME);
      expect(JSON.stringify(b.finalState)).toBe(JSON.stringify(a.finalState));
      expect(JSON.stringify(b.eventLog)).toBe(JSON.stringify(a.eventLog));
    }
  });
});
