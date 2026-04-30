/**
 * Field Goal (run.js:2040).
 *
 * Distance = (100 - ballOn) + 17. So from the 50, FG = 67-yard attempt.
 *
 * Die roll determines success by distance band:
 *   distance > 65        → 1-in-1000 chance (effectively auto-miss)
 *   distance >= 60       → needs die = 6
 *   distance >= 50       → needs die >= 5
 *   distance >= 40       → needs die >= 4
 *   distance >= 30       → needs die >= 3
 *   distance >= 20       → needs die >= 2
 *   distance <  20       → auto-make
 *
 * If a timeout was called by the defense just prior (kicker icing), die++.
 *
 * Success → +3 points, kickoff to opponent.
 * Miss    → possession flips at the SPOT OF THE KICK (not the line of scrimmage).
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState } from "../../types.js";
import { opp } from "../../state.js";
import { blankPick, type SpecialResolution } from "./shared.js";

export interface FieldGoalOptions {
  /** true if the opposing team called a timeout that should ice the kicker. */
  iced?: boolean;
}

export function resolveFieldGoal(
  state: GameState,
  rng: Rng,
  opts: FieldGoalOptions = {},
): SpecialResolution {
  const offense = state.field.offense;
  const distance = 100 - state.field.ballOn + 17;
  const rawDie = rng.d6();
  const die = opts.iced ? Math.min(6, rawDie + 1) : rawDie;

  const events: Event[] = [];

  let make: boolean;
  if (distance > 65) {
    // Essentially impossible — rolled 1-1000, make only on exact hit.
    make = rng.intBetween(1, 1000) === distance;
  } else if (distance >= 60) make = die >= 6;
  else if (distance >= 50) make = die >= 5;
  else if (distance >= 40) make = die >= 4;
  else if (distance >= 30) make = die >= 3;
  else if (distance >= 20) make = die >= 2;
  else make = true;

  if (make) {
    events.push({ type: "FIELD_GOAL_GOOD", player: offense, roll: die, distance });
    const newPlayers = {
      ...state.players,
      [offense]: { ...state.players[offense], score: state.players[offense].score + 3 },
    } as GameState["players"];
    return {
      state: {
        ...state,
        players: newPlayers,
        pendingPick: blankPick(),
        phase: "KICKOFF",
      },
      events,
    };
  }

  events.push({ type: "FIELD_GOAL_MISSED", player: offense, roll: die, distance });
  events.push({ type: "TURNOVER", reason: "missed_fg" });

  // F-51 fidelity: v5.1 places ball at SPOT OF KICK (7 yards behind LOS in
  // offense POV → mirror + 7 in defender POV). Red-zone misses (kick spot
  // would be inside defender's 20) snap forward to defender's 20.
  const defender = opp(offense);
  const kickSpotInDefenderPov = 100 - state.field.ballOn + 7;
  const newBallOn = kickSpotInDefenderPov <= 20 ? 20 : kickSpotInDefenderPov;
  return {
    state: {
      ...state,
      pendingPick: blankPick(),
      field: {
        ballOn: newBallOn,
        firstDownAt: Math.min(100, newBallOn + 10),
        down: 1,
        offense: defender,
      },
    },
    events,
  };
}
