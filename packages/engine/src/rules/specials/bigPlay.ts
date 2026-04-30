/**
 * Big Play resolution (run.js:1933).
 *
 * Triggered by:
 *   - Trick Play die=5
 *   - Same Play King outcome
 *   - Other future hooks
 *
 * The beneficiary argument says who benefits — this can be offense OR
 * defense (different outcome tables).
 *
 * Offensive Big Play (offense benefits):
 *   die 1-3 → +25 yards
 *   die 4-5 → max(half-to-goal, 40) yards
 *   die 6   → Touchdown
 *
 * Defensive Big Play (defense benefits):
 *   die 1-3 → 10-yard penalty on offense (repeat down), half-to-goal if tight
 *   die 4-5 → FUMBLE → turnover + defense returns max(half, 25)
 *   die 6   → FUMBLE → defensive TD
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState, PlayerId } from "../../types.js";
import { opp } from "../../state.js";
import {
  applySafety,
  applyTouchdown,
  blankPick,
  type SpecialResolution,
} from "./shared.js";

export function resolveBigPlay(
  state: GameState,
  beneficiary: PlayerId,
  rng: Rng,
): SpecialResolution {
  const offense = state.field.offense;
  const die = rng.d6();
  const events: Event[] = [{ type: "BIG_PLAY", beneficiary, subroll: die }];

  if (beneficiary === offense) {
    return offensiveBigPlay(state, offense, die, events);
  }
  return defensiveBigPlay(state, offense, die, events);
}

function offensiveBigPlay(
  state: GameState,
  offense: PlayerId,
  die: 1 | 2 | 3 | 4 | 5 | 6,
  events: Event[],
): SpecialResolution {
  if (die === 6) {
    return applyTouchdown(state, offense, events);
  }

  // die 1-3: +25; die 4-5: max(half-to-goal, 40)
  let gain: number;
  if (die <= 3) {
    gain = 25;
  } else {
    const halfToGoal = Math.round((100 - state.field.ballOn) / 2);
    gain = halfToGoal > 40 ? halfToGoal : 40;
  }

  const projected = state.field.ballOn + gain;
  if (projected >= 100) {
    return applyTouchdown(state, offense, events);
  }

  // Apply gain, check for first down.
  const reachedFirstDown = projected >= state.field.firstDownAt;
  const nextDown = reachedFirstDown ? 1 : state.field.down;
  const nextFirstDownAt = reachedFirstDown
    ? Math.min(100, projected + 10)
    : state.field.firstDownAt;

  if (reachedFirstDown) events.push({ type: "FIRST_DOWN" });

  return {
    state: {
      ...state,
      pendingPick: blankPick(),
      field: {
        ...state.field,
        ballOn: projected,
        down: nextDown,
        firstDownAt: nextFirstDownAt,
      },
    },
    events,
  };
}

function defensiveBigPlay(
  state: GameState,
  offense: PlayerId,
  die: 1 | 2 | 3 | 4 | 5 | 6,
  events: Event[],
): SpecialResolution {
  // 1-3: 10-yard penalty, repeat down (no down consumed).
  if (die <= 3) {
    const naivePenalty = -10;
    const halfToGoal = -Math.floor(state.field.ballOn / 2);
    const penaltyYards =
      state.field.ballOn - 10 < 1 ? halfToGoal : naivePenalty;

    events.push({ type: "PENALTY", against: offense, yards: penaltyYards, lossOfDown: false });
    return {
      state: {
        ...state,
        pendingPick: blankPick(),
        field: {
          ...state.field,
          ballOn: Math.max(0, state.field.ballOn + penaltyYards),
        },
      },
      events,
    };
  }

  // 4-5: turnover with return of max(half, 25). 6: defensive TD.
  const defender = opp(offense);

  if (die === 6) {
    // Defense scores the TD.
    const newPlayers = {
      ...state.players,
      [defender]: { ...state.players[defender], score: state.players[defender].score + 6 },
    } as GameState["players"];
    events.push({ type: "TURNOVER", reason: "fumble" });
    events.push({ type: "TOUCHDOWN", scoringPlayer: defender });
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick(),
        phase: "PAT_CHOICE",
        field: { ...state.field, offense: defender },
      },
      events,
    };
  }

  // die 4-5: turnover with return.
  const halfToGoal = Math.round((100 - state.field.ballOn) / 2);
  const returnYards = halfToGoal > 25 ? halfToGoal : 25;

  events.push({ type: "TURNOVER", reason: "fumble" });

  // F-50 fidelity: v5.1 stores `dist = returnYards` then calls changePoss('to'),
  // which mirrors the ball to defender POV. The return is then applied
  // forward in defender POV (`spot += dist`). Equivalent: defender starts at
  // `100 - ballOn` (their own POV) and advances `returnYards` toward their goal.
  const newOffenseStart = 100 - state.field.ballOn;
  const finalBallOn = newOffenseStart + returnYards;

  if (finalBallOn >= 100) {
    // Returned all the way — TD for defender.
    const newPlayers = {
      ...state.players,
      [defender]: { ...state.players[defender], score: state.players[defender].score + 6 },
    } as GameState["players"];
    events.push({ type: "TOUCHDOWN", scoringPlayer: defender });
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick(),
        phase: "PAT_CHOICE",
        field: { ...state.field, offense: defender },
      },
      events,
    };
  }
  if (finalBallOn <= 0) {
    return applySafety(state, offense, events);
  }

  return {
    state: {
      ...state,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: defender,
      },
    },
    events,
  };
}
