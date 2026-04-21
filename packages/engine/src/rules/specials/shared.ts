/**
 * Shared primitives used by multiple special-play resolvers.
 */

import type { Event } from "../../events.js";
import type { GameState, PlayerId } from "../../types.js";
import { opp } from "../../state.js";

export interface SpecialResolution {
  state: GameState;
  events: Event[];
}

export function blankPick(): GameState["pendingPick"] {
  return { offensePlay: null, defensePlay: null };
}

/**
 * Award points, flip to PAT_CHOICE. Caller emits TOUCHDOWN.
 */
export function applyTouchdown(
  state: GameState,
  scorer: PlayerId,
  events: Event[],
): SpecialResolution {
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 6 },
  } as GameState["players"];
  events.push({ type: "TOUCHDOWN", scoringPlayer: scorer });
  return {
    state: {
      ...state,
      players: newPlayers,
      pendingPick: blankPick(),
      phase: "PAT_CHOICE",
    },
    events,
  };
}

export function applySafety(
  state: GameState,
  conceder: PlayerId,
  events: Event[],
): SpecialResolution {
  const scorer = opp(conceder);
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 2 },
  } as GameState["players"];
  events.push({ type: "SAFETY", scoringPlayer: scorer });
  return {
    state: {
      ...state,
      players: newPlayers,
      pendingPick: blankPick(),
      phase: "KICKOFF",
      isSafetyKick: true,
    },
    events,
  };
}

/**
 * Apply a yardage outcome with full down/turnover/score bookkeeping.
 * Used by specials that produce yardage directly (Hail Mary, Big Play return).
 */
export function applyYardageOutcome(
  state: GameState,
  yards: number,
  events: Event[],
): SpecialResolution {
  const offense = state.field.offense;
  const projected = state.field.ballOn + yards;

  if (projected >= 100) return applyTouchdown(state, offense, events);
  if (projected <= 0) return applySafety(state, offense, events);

  const reachedFirstDown = projected >= state.field.firstDownAt;
  let nextDown = state.field.down;
  let nextFirstDownAt = state.field.firstDownAt;
  let possessionFlipped = false;

  if (reachedFirstDown) {
    nextDown = 1;
    nextFirstDownAt = Math.min(100, projected + 10);
    events.push({ type: "FIRST_DOWN" });
  } else if (state.field.down === 4) {
    possessionFlipped = true;
    events.push({ type: "TURNOVER_ON_DOWNS" });
    events.push({ type: "TURNOVER", reason: "downs" });
  } else {
    nextDown = (state.field.down + 1) as 1 | 2 | 3 | 4;
  }

  const mirroredBallOn = possessionFlipped ? 100 - projected : projected;

  return {
    state: {
      ...state,
      pendingPick: blankPick(),
      field: {
        ballOn: mirroredBallOn,
        firstDownAt: possessionFlipped
          ? Math.min(100, mirroredBallOn + 10)
          : nextFirstDownAt,
        down: possessionFlipped ? 1 : nextDown,
        offense: possessionFlipped ? opp(offense) : offense,
      },
    },
    events,
  };
}
