/**
 * Public API of @fbg/engine.
 *
 * Consumers (browser frontend, Supabase Edge Functions, CLI replay tool)
 * import only from here.
 */

export type { Action } from "./actions.js";
export type { Event } from "./events.js";
export type {
  ClockState,
  DeckState,
  FieldState,
  GamePhase,
  GameState,
  Hand,
  OvertimeState,
  PendingPick,
  PlayCall,
  PlayerId,
  PlayerState,
  RegularPlay,
  SpecialPlay,
  Stats,
  TeamRef,
} from "./types.js";

export { reduce, reduceMany, type ReduceResult } from "./reducer.js";
export { initialState, opp, emptyHand, emptyStats } from "./state.js";
export { type Rng, seededRng } from "./rng.js";

export { matchupQuality, MATCHUP, MULTI } from "./rules/matchup.js";
export { computeYardage, type YardageInputs, type YardageOutcome } from "./rules/yardage.js";
export {
  startOvertime,
  startOvertimePossession,
  endOvertimePossession,
} from "./rules/overtime.js";
