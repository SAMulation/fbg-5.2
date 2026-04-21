/**
 * Hail Mary outcomes (run.js:2242). Die value → result, from offense's POV:
 *   1 → BIG SACK, -10 yards
 *   2 → +20 yards
 *   3 →   0 yards
 *   4 → +40 yards
 *   5 → INTERCEPTION (turnover at spot)
 *   6 → TOUCHDOWN
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState } from "../../types.js";
import { opp } from "../../state.js";
import {
  applySafety,
  applyTouchdown,
  applyYardageOutcome,
  blankPick,
  type SpecialResolution,
} from "./shared.js";

export function resolveHailMary(state: GameState, rng: Rng): SpecialResolution {
  const offense = state.field.offense;
  const die = rng.d6();
  const events: Event[] = [{ type: "HAIL_MARY_ROLL", outcome: die }];

  // Decrement HM count regardless of outcome.
  const updatedPlayers = {
    ...state.players,
    [offense]: {
      ...state.players[offense],
      hand: { ...state.players[offense].hand, HM: Math.max(0, state.players[offense].hand.HM - 1) },
    },
  } as GameState["players"];
  const stateWithHm: GameState = { ...state, players: updatedPlayers };

  // Interception (die 5) — turnover at the spot, possession flips.
  if (die === 5) {
    events.push({ type: "TURNOVER", reason: "interception" });
    return {
      state: {
        ...stateWithHm,
        pendingPick: blankPick(),
        field: {
          ...stateWithHm.field,
          offense: opp(offense),
          ballOn: 100 - stateWithHm.field.ballOn,
          firstDownAt: Math.min(100, 100 - stateWithHm.field.ballOn + 10),
          down: 1,
        },
      },
      events,
    };
  }

  // Touchdown (die 6).
  if (die === 6) {
    return applyTouchdown(stateWithHm, offense, events);
  }

  // Yardage outcomes (die 1, 2, 3, 4).
  const yards = die === 1 ? -10 : die === 2 ? 20 : die === 3 ? 0 : 40;
  const projected = stateWithHm.field.ballOn + yards;

  if (projected >= 100) return applyTouchdown(stateWithHm, offense, events);
  if (projected <= 0) return applySafety(stateWithHm, offense, events);

  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: "HM",
    defensePlay: state.pendingPick.defensePlay ?? "SR",
    matchupQuality: 0,
    multiplier: { card: "10", value: 0 },
    yardsCard: 0,
    yardsGained: yards,
    newBallOn: projected,
  });

  return applyYardageOutcome(stateWithHm, yards, events);
}
