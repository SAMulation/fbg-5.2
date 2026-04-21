/**
 * Actions are the only inputs the engine accepts.
 *
 * Actions describe *intent* ("player 1 wants to call Short Run"), not outcomes.
 * The engine validates and resolves them. Server receives actions over the wire
 * from clients; clients never mutate state directly.
 */

import type { PlayCall, PlayerId } from "./types.js";

export type Action =
  | { type: "START_GAME"; quarterLengthMinutes: number; teams: { 1: string; 2: string } }
  | { type: "COIN_TOSS_CALL"; player: PlayerId; call: "heads" | "tails" }
  | { type: "RECEIVE_CHOICE"; player: PlayerId; choice: "receive" | "defer" }
  | { type: "PICK_PLAY"; player: PlayerId; play: PlayCall }
  | { type: "CALL_TIMEOUT"; player: PlayerId }
  | { type: "ACCEPT_PENALTY"; player: PlayerId }
  | { type: "DECLINE_PENALTY"; player: PlayerId }
  | { type: "PAT_CHOICE"; player: PlayerId; choice: "kick" | "two_point" }
  | { type: "FOURTH_DOWN_CHOICE"; player: PlayerId; choice: "go" | "punt" | "fg" }
  | { type: "FORFEIT"; player: PlayerId }
  /**
   * Resolve the current kickoff. Orchestrator sends this after entering the
   * KICKOFF phase. Engine runs the kickoff mechanic and transitions to REG_PLAY.
   */
  | { type: "RESOLVE_KICKOFF" }
  /** Tick the clock by N seconds — used for the natural 30s-per-play decrement. */
  | { type: "TICK_CLOCK"; seconds: number };
