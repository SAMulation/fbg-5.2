/**
 * The single transition function. Takes (state, action, rng) and returns
 * a new state plus the events that describe what happened.
 *
 * This file is the *skeleton* — the dispatch shape is here, the cases are
 * mostly stubs marked `// TODO: port from run.js`. As we port, each case
 * gets unit-tested. When every case is implemented and tested, v5.1's run.js
 * can be deleted.
 *
 * Rules for this file:
 *   1. NEVER import from DOM, network, or animation modules.
 *   2. NEVER mutate `state` — always return a new object.
 *   3. NEVER call Math.random — use the `rng` parameter.
 *   4. NEVER throw on invalid actions — return `{ state, events: [] }`
 *      and let the caller decide. (Validation is the server's job.)
 */

import type { Action } from "./actions.js";
import type { Event } from "./events.js";
import type { GameState } from "./types.js";
import type { Rng } from "./rng.js";
import { isRegularPlay, resolveRegularPlay } from "./rules/play.js";
import {
  resolveFieldGoal,
  resolveHailMary,
  resolveKickoff,
  resolveOffensiveTrickPlay,
  resolvePunt,
  resolveSamePlay,
} from "./rules/specials/index.js";
import { opp } from "./state.js";

export interface ReduceResult {
  state: GameState;
  events: Event[];
}

export function reduce(state: GameState, action: Action, rng: Rng): ReduceResult {
  switch (action.type) {
    case "START_GAME":
      return {
        state: {
          ...state,
          phase: "COIN_TOSS",
          clock: {
            ...state.clock,
            quarter: 1,
            quarterLengthMinutes: action.quarterLengthMinutes,
            secondsRemaining: action.quarterLengthMinutes * 60,
          },
          players: {
            ...state.players,
            1: { ...state.players[1], team: { id: action.teams[1] } },
            2: { ...state.players[2], team: { id: action.teams[2] } },
          },
        },
        events: [{ type: "GAME_STARTED" }],
      };

    case "COIN_TOSS_CALL": {
      const actual = rng.coinFlip();
      const winner = action.call === actual ? action.player : opp(action.player);
      return {
        state,
        events: [{ type: "COIN_TOSS_RESULT", result: actual, winner }],
      };
    }

    case "RECEIVE_CHOICE": {
      // The caller's choice determines who receives the opening kickoff.
      // "receive" → caller receives; "defer" → caller kicks (opponent receives).
      const receiver = action.choice === "receive" ? action.player : opp(action.player);
      // Kicker is the opening offense (they kick off); receiver gets the ball after.
      const kicker = opp(receiver);
      return {
        state: {
          ...state,
          phase: "KICKOFF",
          openingReceiver: receiver,
          field: { ...state.field, offense: kicker },
        },
        events: [{ type: "KICKOFF", receivingPlayer: receiver, ballOn: 35 }],
      };
    }

    case "RESOLVE_KICKOFF": {
      const result = resolveKickoff(state, rng);
      return { state: result.state, events: result.events };
    }

    case "PICK_PLAY": {
      const offense = state.field.offense;
      const isOffensiveCall = action.player === offense;
      const events: Event[] = [
        { type: "PLAY_CALLED", player: action.player, play: action.play },
      ];

      const pendingPick = {
        offensePlay: isOffensiveCall ? action.play : state.pendingPick.offensePlay,
        defensePlay: isOffensiveCall ? state.pendingPick.defensePlay : action.play,
      };

      // Both teams have picked — resolve.
      if (pendingPick.offensePlay && pendingPick.defensePlay) {
        const stateWithPick: GameState = { ...state, pendingPick };

        // Hail Mary by offense — resolves immediately, defense pick ignored.
        if (pendingPick.offensePlay === "HM") {
          const hm = resolveHailMary(stateWithPick, rng);
          return { state: hm.state, events: [...events, ...hm.events] };
        }

        // Trick Play by offense.
        if (pendingPick.offensePlay === "TP") {
          const tp = resolveOffensiveTrickPlay(stateWithPick, rng);
          return { state: tp.state, events: [...events, ...tp.events] };
        }

        // Regular vs regular.
        if (
          isRegularPlay(pendingPick.offensePlay) &&
          isRegularPlay(pendingPick.defensePlay)
        ) {
          // Same play? 50/50 chance to trigger Same Play mechanism.
          // Source: run.js:1886 (`if (pl1 === pl2)`).
          if (pendingPick.offensePlay === pendingPick.defensePlay) {
            const trigger = rng.coinFlip();
            if (trigger === "heads") {
              const sp = resolveSamePlay(stateWithPick, rng);
              return { state: sp.state, events: [...events, ...sp.events] };
            }
            // Tails: fall through to regular resolution (quality 5 outcome).
          }

          const resolved = resolveRegularPlay(
            stateWithPick,
            {
              offensePlay: pendingPick.offensePlay,
              defensePlay: pendingPick.defensePlay,
            },
            rng,
          );
          return { state: resolved.state, events: [...events, ...resolved.events] };
        }

        // Defensive trick play, FG, PUNT, TWO_PT picks — not routed here yet.
        // FG/PUNT/TWO_PT are driven by FOURTH_DOWN_CHOICE / PAT_CHOICE actions,
        // not by PICK_PLAY. Defensive TP is a TODO.
        return { state: stateWithPick, events };
      }

      return { state: { ...state, pendingPick }, events };
    }

    case "CALL_TIMEOUT": {
      const p = state.players[action.player];
      if (p.timeouts <= 0) return { state, events: [] };
      const remaining = p.timeouts - 1;
      return {
        state: {
          ...state,
          players: {
            ...state.players,
            [action.player]: { ...p, timeouts: remaining },
          },
        },
        events: [{ type: "TIMEOUT_CALLED", player: action.player, remaining }],
      };
    }

    case "ACCEPT_PENALTY":
    case "DECLINE_PENALTY":
      // Penalties are captured as events at resolution time, but accept/decline
      // flow requires state not yet modeled (pending penalty). TODO when
      // penalty mechanics are ported from run.js.
      return { state, events: [] };

    case "PAT_CHOICE": {
      const scorer = state.field.offense;
      if (action.choice === "kick") {
        // Assume automatic in v5.1 — no mechanic recorded for PAT kicks.
        const newPlayers = {
          ...state.players,
          [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 1 },
        } as GameState["players"];
        return {
          state: {
            ...state,
            players: newPlayers,
            phase: "KICKOFF",
          },
          events: [{ type: "PAT_GOOD", player: scorer }],
        };
      }
      // two_point → transition to TWO_PT_CONV phase; a PICK_PLAY resolves it.
      return {
        state: {
          ...state,
          phase: "TWO_PT_CONV",
          field: { ...state.field, ballOn: 97, firstDownAt: 100, down: 1 },
        },
        events: [],
      };
    }

    case "FOURTH_DOWN_CHOICE": {
      if (action.choice === "go") {
        // Nothing to do — the next PICK_PLAY will resolve normally from 4th down.
        return { state, events: [] };
      }
      if (action.choice === "punt") {
        const result = resolvePunt(state, rng);
        return { state: result.state, events: result.events };
      }
      // fg
      const result = resolveFieldGoal(state, rng);
      return { state: result.state, events: result.events };
    }

    case "FORFEIT": {
      const winner = opp(action.player);
      return {
        state: { ...state, phase: "GAME_OVER" },
        events: [{ type: "GAME_OVER", winner }],
      };
    }

    case "TICK_CLOCK": {
      const prev = state.clock.secondsRemaining;
      const next = Math.max(0, prev - action.seconds);
      const events: Event[] = [{ type: "CLOCK_TICKED", seconds: action.seconds }];

      // Two-minute warning: crossing 120 seconds in Q2 or Q4 triggers an event.
      if (
        (state.clock.quarter === 2 || state.clock.quarter === 4) &&
        prev > 120 &&
        next <= 120
      ) {
        events.push({ type: "TWO_MINUTE_WARNING" });
      }

      if (next === 0) {
        events.push({ type: "QUARTER_ENDED", quarter: state.clock.quarter });
        // Q1→Q2 and Q3→Q4: roll over clock, same half, same possession continues.
        if (state.clock.quarter === 1 || state.clock.quarter === 3) {
          return {
            state: {
              ...state,
              clock: {
                ...state.clock,
                quarter: state.clock.quarter + 1,
                secondsRemaining: state.clock.quarterLengthMinutes * 60,
              },
            },
            events,
          };
        }
        // End of Q2 = halftime. Q4 end = regulation over.
        if (state.clock.quarter === 2) {
          events.push({ type: "HALF_ENDED" });
          // Receiver of opening kickoff kicks the second half; flip possession.
          const secondHalfReceiver =
            state.openingReceiver === null ? 1 : opp(state.openingReceiver);
          return {
            state: {
              ...state,
              phase: "KICKOFF",
              clock: {
                ...state.clock,
                quarter: 3,
                secondsRemaining: state.clock.quarterLengthMinutes * 60,
              },
              field: { ...state.field, offense: opp(secondHalfReceiver) },
              // Refresh timeouts for new half.
              players: {
                ...state.players,
                1: { ...state.players[1], timeouts: 3 },
                2: { ...state.players[2], timeouts: 3 },
              },
            },
            events,
          };
        }
        // Q4 ended.
        const p1 = state.players[1].score;
        const p2 = state.players[2].score;
        if (p1 !== p2) {
          const winner = p1 > p2 ? 1 : 2;
          events.push({ type: "GAME_OVER", winner });
          return { state: { ...state, phase: "GAME_OVER" }, events };
        }
        // Tied — head to overtime.
        events.push({ type: "OVERTIME_STARTED", period: 1, possession: 1 });
        return {
          state: {
            ...state,
            phase: "OT_START",
            overtime: {
              period: 1,
              possession: 1,
              firstReceiver: 1,
            },
            clock: { ...state.clock, quarter: 5, secondsRemaining: 0 },
          },
          events,
        };
      }

      return {
        state: { ...state, clock: { ...state.clock, secondsRemaining: next } },
        events,
      };
    }

    default: {
      // Exhaustiveness check — adding a new Action variant without handling it
      // here will produce a compile error.
      const _exhaustive: never = action;
      void _exhaustive;
      return { state, events: [] };
    }
  }
}

/**
 * Convenience for replaying a sequence of actions — useful for tests and
 * for server-side game replay from action log.
 */
export function reduceMany(
  state: GameState,
  actions: Action[],
  rng: Rng,
): ReduceResult {
  let current = state;
  const events: Event[] = [];
  for (const action of actions) {
    const result = reduce(current, action, rng);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}
