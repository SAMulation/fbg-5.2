/**
 * Outer game flow tests — coin toss, kickoff, PAT, 4th down, timeouts,
 * clock, quarter transitions, halftime, and OT entry.
 */

import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { initialState } from "../state.js";
import { seededRng } from "../rng.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const fresh = (): GameState =>
  initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });

describe("START_GAME", () => {
  it("transitions INIT → COIN_TOSS, quarter 1, clock set", () => {
    const r = reduce(
      fresh(),
      { type: "START_GAME", quarterLengthMinutes: 5, teams: { 1: "NE", 2: "GB" } },
      seededRng(1),
    );
    expect(r.state.phase).toBe("COIN_TOSS");
    expect(r.state.clock.quarter).toBe(1);
    expect(r.state.clock.secondsRemaining).toBe(300);
    expect(r.events).toEqual([{ type: "GAME_STARTED" }]);
  });
});

describe("COIN_TOSS_CALL", () => {
  const heads: Rng = { d6: () => 1, coinFlip: () => "heads", intBetween: () => 0 };
  const tails: Rng = { ...heads, coinFlip: () => "tails" };

  // validateAction requires phase=COIN_TOSS for COIN_TOSS_CALL, so step
  // the state through START_GAME first.
  const afterStart = (): GameState => ({ ...fresh(), phase: "COIN_TOSS" });

  it("caller wins if call matches flip", () => {
    const r = reduce(afterStart(), { type: "COIN_TOSS_CALL", player: 1, call: "heads" }, heads);
    const ev = r.events.find((e) => e.type === "COIN_TOSS_RESULT");
    expect(ev?.type === "COIN_TOSS_RESULT" && ev.winner).toBe(1);
  });

  it("caller loses if call mismatches flip", () => {
    const r = reduce(afterStart(), { type: "COIN_TOSS_CALL", player: 1, call: "heads" }, tails);
    const ev = r.events.find((e) => e.type === "COIN_TOSS_RESULT");
    expect(ev?.type === "COIN_TOSS_RESULT" && ev.winner).toBe(2);
  });
});

describe("RECEIVE_CHOICE", () => {
  const rng = seededRng(1);
  it("receive → caller becomes openingReceiver, opponent kicks off", () => {
    const s: GameState = { ...fresh(), phase: "COIN_TOSS" };
    const r = reduce(s, { type: "RECEIVE_CHOICE", player: 1, choice: "receive" }, rng);
    expect(r.state.phase).toBe("KICKOFF");
    expect(r.state.openingReceiver).toBe(1);
    expect(r.state.field.offense).toBe(2); // opponent kicks
  });

  it("defer → opponent becomes openingReceiver, caller kicks off", () => {
    const s: GameState = { ...fresh(), phase: "COIN_TOSS" };
    const r = reduce(s, { type: "RECEIVE_CHOICE", player: 1, choice: "defer" }, rng);
    expect(r.state.openingReceiver).toBe(2);
    expect(r.state.field.offense).toBe(1);
  });
});

describe("RESOLVE_KICKOFF", () => {
  it("kicks from 35 and flips possession to receiver", () => {
    const s: GameState = {
      ...fresh(),
      phase: "KICKOFF",
      openingReceiver: 2,
      field: { ballOn: 35, firstDownAt: 45, down: 1, offense: 1 },
    };
    const r = reduce(s, { type: "RESOLVE_KICKOFF" }, seededRng(1));
    expect(r.state.phase).toBe("REG_PLAY");
    expect(r.state.field.offense).toBe(2);
  });
});

describe("PAT_CHOICE", () => {
  const postTdState = (): GameState => ({
    ...fresh(),
    phase: "PAT_CHOICE",
    field: { ballOn: 100, firstDownAt: 100, down: 1, offense: 1 },
    players: {
      1: { ...fresh().players[1], score: 6 },
      2: { ...fresh().players[2], score: 0 },
    },
  });

  it("kick → +1, transitions to KICKOFF", () => {
    const r = reduce(postTdState(), { type: "PAT_CHOICE", player: 1, choice: "kick" }, seededRng(1));
    expect(r.state.players[1].score).toBe(7);
    expect(r.state.phase).toBe("KICKOFF");
    expect(r.events.some((e) => e.type === "PAT_GOOD")).toBe(true);
  });

  it("two_point → transitions to TWO_PT_CONV at the 3", () => {
    const r = reduce(postTdState(), { type: "PAT_CHOICE", player: 1, choice: "two_point" }, seededRng(1));
    expect(r.state.phase).toBe("TWO_PT_CONV");
    expect(r.state.field.ballOn).toBe(97);
    expect(r.state.players[1].score).toBe(6); // no bonus yet
  });
});

describe("FOURTH_DOWN_CHOICE", () => {
  const s: GameState = {
    ...fresh(),
    phase: "REG_PLAY",
    // ballOn 45 so FG is in range (validator rejects FG from <45)
    field: { ballOn: 45, firstDownAt: 55, down: 4, offense: 1 },
  };

  it("go → no-op, next PICK_PLAY continues the down", () => {
    const r = reduce(s, { type: "FOURTH_DOWN_CHOICE", player: 1, choice: "go" }, seededRng(1));
    expect(r.state).toEqual(s);
    expect(r.events).toEqual([]);
  });

  it("punt → resolves punt (possession flip expected)", () => {
    const r = reduce(s, { type: "FOURTH_DOWN_CHOICE", player: 1, choice: "punt" }, seededRng(1));
    expect(r.events.some((e) => e.type === "PUNT")).toBe(true);
  });

  it("fg → resolves field goal", () => {
    const r = reduce(s, { type: "FOURTH_DOWN_CHOICE", player: 1, choice: "fg" }, seededRng(1));
    const types = r.events.map((e) => e.type);
    expect(types.some((t) => t === "FIELD_GOAL_GOOD" || t === "FIELD_GOAL_MISSED")).toBe(true);
  });
});

describe("CALL_TIMEOUT", () => {
  it("decrements timeouts and emits TIMEOUT_CALLED", () => {
    const s = fresh();
    const r = reduce(s, { type: "CALL_TIMEOUT", player: 1 }, seededRng(1));
    expect(r.state.players[1].timeouts).toBe(2);
    expect(r.events[0]?.type).toBe("TIMEOUT_CALLED");
  });

  it("is a no-op when no timeouts remain", () => {
    const s: GameState = {
      ...fresh(),
      players: { 1: { ...fresh().players[1], timeouts: 0 }, 2: fresh().players[2] },
    };
    const r = reduce(s, { type: "CALL_TIMEOUT", player: 1 }, seededRng(1));
    expect(r.state).toEqual(s);
    expect(r.events).toEqual([]);
  });
});

describe("TICK_CLOCK", () => {
  it("decrements secondsRemaining", () => {
    const s: GameState = {
      ...fresh(),
      clock: { quarter: 1, secondsRemaining: 300, quarterLengthMinutes: 7 },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.state.clock.secondsRemaining).toBe(270);
  });

  it("emits TWO_MINUTE_WARNING when crossing 120s in Q2", () => {
    const s: GameState = {
      ...fresh(),
      clock: { quarter: 2, secondsRemaining: 125, quarterLengthMinutes: 7 },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.events.some((e) => e.type === "TWO_MINUTE_WARNING")).toBe(true);
  });

  it("does NOT emit TWO_MINUTE_WARNING in Q1", () => {
    const s: GameState = {
      ...fresh(),
      clock: { quarter: 1, secondsRemaining: 125, quarterLengthMinutes: 7 },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.events.some((e) => e.type === "TWO_MINUTE_WARNING")).toBe(false);
  });

  it("Q1 → Q2 rollover keeps possession and resets clock", () => {
    const s: GameState = {
      ...fresh(),
      phase: "REG_PLAY",
      clock: { quarter: 1, secondsRemaining: 10, quarterLengthMinutes: 7 },
      field: { ballOn: 50, firstDownAt: 60, down: 1, offense: 1 },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.state.clock.quarter).toBe(2);
    expect(r.state.clock.secondsRemaining).toBe(420);
    expect(r.state.field.offense).toBe(1);
    expect(r.events.some((e) => e.type === "QUARTER_ENDED")).toBe(true);
  });

  it("end of Q2 → halftime, flips receiver, refreshes timeouts", () => {
    const s: GameState = {
      ...fresh(),
      phase: "REG_PLAY",
      openingReceiver: 1,
      clock: { quarter: 2, secondsRemaining: 5, quarterLengthMinutes: 7 },
      players: {
        1: { ...fresh().players[1], timeouts: 0 },
        2: { ...fresh().players[2], timeouts: 1 },
      },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.events.some((e) => e.type === "HALF_ENDED")).toBe(true);
    expect(r.state.clock.quarter).toBe(3);
    // Opening receiver was 1, so second-half receiver is 2 → kicker is 1.
    expect(r.state.field.offense).toBe(1);
    expect(r.state.players[1].timeouts).toBe(3);
    expect(r.state.players[2].timeouts).toBe(3);
    expect(r.state.phase).toBe("KICKOFF");
  });

  it("end of Q4 with score diff → GAME_OVER with winner", () => {
    const s: GameState = {
      ...fresh(),
      phase: "REG_PLAY",
      clock: { quarter: 4, secondsRemaining: 5, quarterLengthMinutes: 7 },
      players: {
        1: { ...fresh().players[1], score: 14 },
        2: { ...fresh().players[2], score: 7 },
      },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.state.phase).toBe("GAME_OVER");
    const gameOver = r.events.find((e) => e.type === "GAME_OVER");
    expect(gameOver?.type === "GAME_OVER" && gameOver.winner).toBe(1);
  });

  it("end of Q4 tied → overtime", () => {
    const s: GameState = {
      ...fresh(),
      phase: "REG_PLAY",
      clock: { quarter: 4, secondsRemaining: 5, quarterLengthMinutes: 7 },
      players: {
        1: { ...fresh().players[1], score: 14 },
        2: { ...fresh().players[2], score: 14 },
      },
    };
    const r = reduce(s, { type: "TICK_CLOCK", seconds: 30 }, seededRng(1));
    expect(r.events.some((e) => e.type === "OVERTIME_STARTED")).toBe(true);
    expect(r.state.phase).toBe("OT_START");
    expect(r.state.overtime?.period).toBe(1);
  });
});

describe("FORFEIT", () => {
  it("ends the game with opponent as winner", () => {
    const r = reduce(fresh(), { type: "FORFEIT", player: 1 }, seededRng(1));
    expect(r.state.phase).toBe("GAME_OVER");
    const gameOver = r.events.find((e) => e.type === "GAME_OVER");
    expect(gameOver?.type === "GAME_OVER" && gameOver.winner).toBe(2);
  });
});
