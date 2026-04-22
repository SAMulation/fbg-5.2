/**
 * Validator tests. Every rejection path exists because the DO accepts
 * actions from unauthenticated clients — a malformed payload would
 * otherwise be silently ignored by a missing reducer branch, or worse,
 * reach into state with a bogus value.
 */

import { describe, expect, it } from "vitest";
import { reduce } from "../reducer.js";
import { initialState } from "../state.js";
import { seededRng } from "../rng.js";
import { validateAction } from "../validate.js";
import type { Action } from "../actions.js";
import type { GameState } from "../types.js";

const fresh = (phase: GameState["phase"] = "INIT"): GameState => ({
  ...initialState({ team1: { id: "NE" }, team2: { id: "GB" }, quarterLengthMinutes: 7 }),
  phase,
});

describe("validateAction — phase gating", () => {
  it("rejects START_GAME after INIT", () => {
    expect(
      validateAction(fresh("REG_PLAY"), {
        type: "START_GAME",
        quarterLengthMinutes: 7,
        teams: { 1: "NE", 2: "GB" },
      }),
    ).not.toBeNull();
  });

  it("rejects COIN_TOSS_CALL outside COIN_TOSS phase", () => {
    expect(
      validateAction(fresh("REG_PLAY"), { type: "COIN_TOSS_CALL", player: 1, call: "heads" }),
    ).not.toBeNull();
  });

  it("rejects PICK_PLAY during COIN_TOSS", () => {
    expect(
      validateAction(fresh("COIN_TOSS"), { type: "PICK_PLAY", player: 1, play: "SR" }),
    ).not.toBeNull();
  });

  it("rejects PICK_PLAY during KICKOFF", () => {
    expect(
      validateAction(fresh("KICKOFF"), { type: "PICK_PLAY", player: 1, play: "SR" }),
    ).not.toBeNull();
  });

  it("accepts PICK_PLAY during REG_PLAY / OT_PLAY / TWO_PT_CONV", () => {
    for (const phase of ["REG_PLAY", "OT_PLAY", "TWO_PT_CONV"] as const) {
      expect(
        validateAction(fresh(phase), { type: "PICK_PLAY", player: 1, play: "SR" }),
      ).toBeNull();
    }
  });

  it("rejects PAT_CHOICE outside PAT_CHOICE phase", () => {
    expect(
      validateAction(fresh("REG_PLAY"), { type: "PAT_CHOICE", player: 1, choice: "kick" }),
    ).not.toBeNull();
  });

  it("rejects RESOLVE_KICKOFF outside KICKOFF phase", () => {
    expect(
      validateAction(fresh("REG_PLAY"), { type: "RESOLVE_KICKOFF" }),
    ).not.toBeNull();
  });
});

describe("validateAction — payload shape", () => {
  it("rejects bad kickType enum", () => {
    const s = fresh("KICKOFF");
    expect(
      validateAction(s, {
        type: "RESOLVE_KICKOFF",
        kickType: "FG" as unknown as "RK",
      }),
    ).not.toBeNull();
  });

  it("rejects bad returnType enum", () => {
    const s = fresh("KICKOFF");
    expect(
      validateAction(s, {
        type: "RESOLVE_KICKOFF",
        returnType: "ZZ" as unknown as "RR",
      }),
    ).not.toBeNull();
  });

  it("accepts undefined kickType/returnType (safety kick path)", () => {
    expect(validateAction(fresh("KICKOFF"), { type: "RESOLVE_KICKOFF" })).toBeNull();
  });

  it("rejects bad player id on CALL_TIMEOUT", () => {
    const action = {
      type: "CALL_TIMEOUT",
      player: 3 as unknown as 1,
    } satisfies Action;
    expect(validateAction(fresh("REG_PLAY"), action)).not.toBeNull();
  });

  it("rejects CALL_TIMEOUT when player has none left", () => {
    const s = {
      ...fresh("REG_PLAY"),
      players: {
        ...fresh().players,
        1: { ...fresh().players[1], timeouts: 0 },
      },
    };
    expect(validateAction(s, { type: "CALL_TIMEOUT", player: 1 })).not.toBeNull();
  });

  it("rejects bogus PICK_PLAY play string", () => {
    expect(
      validateAction(fresh("REG_PLAY"), {
        type: "PICK_PLAY",
        player: 1,
        play: "XX" as unknown as "SR",
      }),
    ).not.toBeNull();
  });

  it("rejects TICK_CLOCK with negative seconds", () => {
    expect(validateAction(fresh("REG_PLAY"), { type: "TICK_CLOCK", seconds: -5 })).not.toBeNull();
  });

  it("rejects FG attempt from <45", () => {
    const s = {
      ...fresh("REG_PLAY"),
      field: { ballOn: 30, firstDownAt: 40, down: 4, offense: 1 as const },
    };
    expect(
      validateAction(s, { type: "FOURTH_DOWN_CHOICE", player: 1, choice: "fg" }),
    ).not.toBeNull();
  });

  it("rejects punt in OT", () => {
    const s = {
      ...fresh("OT_PLAY"),
      field: { ballOn: 25, firstDownAt: 35, down: 4, offense: 1 as const },
    };
    expect(
      validateAction(s, { type: "FOURTH_DOWN_CHOICE", player: 1, choice: "punt" }),
    ).not.toBeNull();
  });
});

describe("reduce — silently drops invalid actions", () => {
  it("state unchanged when validation fails", () => {
    const s = fresh("REG_PLAY");
    const r = reduce(s, { type: "COIN_TOSS_CALL", player: 1, call: "heads" }, seededRng(1));
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });

  it("malformed RESOLVE_KICKOFF no-ops instead of corrupting state", () => {
    const s = fresh("KICKOFF");
    const r = reduce(
      s,
      { type: "RESOLVE_KICKOFF", kickType: "HACKED" as unknown as "RK" },
      seededRng(1),
    );
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
});
