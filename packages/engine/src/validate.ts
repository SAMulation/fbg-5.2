/**
 * Action validation layer. Runs *before* `reduce` touches state.
 *
 * The engine previously relied on the reducer's per-case shape checks and
 * silently ignored anything it couldn't recognize. That was fine for a
 * trusted single-tab game but unsafe as soon as the Durable Object
 * accepts actions from unauthenticated WebSocket clients — a hostile (or
 * just buggy) client could send `{ type: 'RESOLVE_KICKOFF', kickType: 'FG' }`
 * and corrupt state.
 *
 * `validateAction` returns null when the action is legal for the current
 * state, or a string explaining the rejection. Invalid actions should be
 * no-oped by the caller (reducer or server), not thrown on — that matches
 * the rest of the engine's "illegal picks are silently dropped" contract
 * and avoids crashing on an untrusted client.
 */

import type { Action } from "./actions.js";
import type { GameState, KickType, ReturnType } from "./types.js";

const KICK_TYPES: KickType[] = ["RK", "OK", "SK"];
const RETURN_TYPES: ReturnType[] = ["RR", "OR", "TB"];

const PLAY_PHASES = new Set(["REG_PLAY", "OT_PLAY", "TWO_PT_CONV"]);

export function validateAction(state: GameState, action: Action): string | null {
  switch (action.type) {
    case "START_GAME":
      if (state.phase !== "INIT") return "START_GAME only valid in INIT";
      if (typeof action.quarterLengthMinutes !== "number") return "bad qtrLen";
      if (action.quarterLengthMinutes < 1 || action.quarterLengthMinutes > 15) {
        return "qtrLen must be 1..15";
      }
      if (!action.teams || typeof action.teams[1] !== "string" || typeof action.teams[2] !== "string") {
        return "teams missing";
      }
      return null;

    case "COIN_TOSS_CALL":
      if (state.phase !== "COIN_TOSS") return "not in COIN_TOSS";
      if (!isPlayer(action.player)) return "bad player";
      if (action.call !== "heads" && action.call !== "tails") return "bad call";
      return null;

    case "RECEIVE_CHOICE":
      // Allowed only after the coin toss resolves; engine's reducer leaves
      // state.phase at COIN_TOSS until RECEIVE_CHOICE transitions to KICKOFF.
      if (state.phase !== "COIN_TOSS") return "not in COIN_TOSS";
      if (!isPlayer(action.player)) return "bad player";
      if (action.choice !== "receive" && action.choice !== "defer") return "bad choice";
      return null;

    case "PICK_PLAY":
      if (!PLAY_PHASES.has(state.phase)) return "not in a play phase";
      if (!isPlayer(action.player)) return "bad player";
      if (!isPlayCall(action.play)) return "bad play";
      return null;

    case "CALL_TIMEOUT":
      if (!isPlayer(action.player)) return "bad player";
      if (state.players[action.player].timeouts <= 0) return "no timeouts remaining";
      return null;

    case "ACCEPT_PENALTY":
    case "DECLINE_PENALTY":
      if (!isPlayer(action.player)) return "bad player";
      return null;

    case "PAT_CHOICE":
      if (state.phase !== "PAT_CHOICE") return "not in PAT_CHOICE";
      if (!isPlayer(action.player)) return "bad player";
      if (action.choice !== "kick" && action.choice !== "two_point") return "bad choice";
      return null;

    case "FOURTH_DOWN_CHOICE":
      if (state.phase !== "REG_PLAY" && state.phase !== "OT_PLAY") return "wrong phase";
      if (state.field.down !== 4) return "not 4th down";
      if (!isPlayer(action.player)) return "bad player";
      if (action.choice !== "go" && action.choice !== "punt" && action.choice !== "fg") {
        return "bad choice";
      }
      if (action.choice === "punt" && state.phase === "OT_PLAY") return "no punts in OT";
      if (action.choice === "fg" && state.field.ballOn < 45) return "out of FG range";
      return null;

    case "FORFEIT":
      if (!isPlayer(action.player)) return "bad player";
      return null;

    case "RESOLVE_KICKOFF":
      if (state.phase !== "KICKOFF") return "not in KICKOFF";
      // Picks are optional (safety kicks skip them), but when present they
      // must be legal enum values.
      if (action.kickType !== undefined && !KICK_TYPES.includes(action.kickType)) {
        return "bad kickType";
      }
      if (action.returnType !== undefined && !RETURN_TYPES.includes(action.returnType)) {
        return "bad returnType";
      }
      return null;

    case "START_OT_POSSESSION":
      if (state.phase !== "OT_START") return "not in OT_START";
      return null;

    case "TICK_CLOCK":
      if (typeof action.seconds !== "number") return "bad seconds";
      if (action.seconds < 0 || action.seconds > 300) return "seconds out of range";
      return null;

    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return "unknown action type";
    }
  }
}

function isPlayer(p: unknown): p is 1 | 2 {
  return p === 1 || p === 2;
}

function isPlayCall(p: unknown): boolean {
  return (
    p === "SR" ||
    p === "LR" ||
    p === "SP" ||
    p === "LP" ||
    p === "TP" ||
    p === "HM" ||
    p === "FG" ||
    p === "PUNT" ||
    p === "TWO_PT"
  );
}
