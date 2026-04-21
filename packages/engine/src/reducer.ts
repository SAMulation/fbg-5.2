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
  resolveDefensiveTrickPlay,
  resolveFieldGoal,
  resolveHailMary,
  resolveKickoff,
  resolveOffensiveTrickPlay,
  resolvePunt,
  resolveSamePlay,
  resolveTwoPointConversion,
} from "./rules/specials/index.js";
import {
  endOvertimePossession,
  isPossessionEndingInOT,
  startOvertime,
  startOvertimePossession,
} from "./rules/overtime.js";
import { opp } from "./state.js";

export interface ReduceResult {
  state: GameState;
  events: Event[];
}

export function reduce(state: GameState, action: Action, rng: Rng): ReduceResult {
  const result = reduceCore(state, action, rng);
  return applyOvertimeRouting(state, result);
}

/**
 * If we're in OT and a possession-ending event just fired, route to the
 * next OT possession (or game end). Skips when the action is itself an OT
 * helper (so we don't double-route).
 */
function applyOvertimeRouting(prevState: GameState, result: ReduceResult): ReduceResult {
  // Only consider routing when we *were* in OT. (startOvertime sets state.overtime.)
  if (!prevState.overtime && !result.state.overtime) return result;
  if (!result.state.overtime) return result;
  if (!isPossessionEndingInOT(result.events)) return result;

  // PAT in OT: a TD scored, but possession doesn't end until PAT/2pt resolves.
  // PAT_GOOD / TWO_POINT_* are themselves possession-ending, so they DO route.
  // After possession ends, decide next.
  const ended = endOvertimePossession(result.state);
  return {
    state: ended.state,
    events: [...result.events, ...ended.events],
  };
}

function reduceCore(state: GameState, action: Action, rng: Rng): ReduceResult {
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

    case "START_OT_POSSESSION": {
      const r = startOvertimePossession(state);
      return { state: r.state, events: r.events };
    }

    case "PICK_PLAY": {
      const offense = state.field.offense;
      const isOffensiveCall = action.player === offense;

      // Validate. Illegal picks are silently no-op'd; the orchestrator
      // (server / UI) is responsible for surfacing the error to the user.
      if (action.play === "FG" || action.play === "PUNT" || action.play === "TWO_PT") {
        return { state, events: [] }; // wrong action type for these
      }
      if (action.play === "HM" && !isOffensiveCall) {
        return { state, events: [] }; // defense can't call Hail Mary
      }
      const hand = state.players[action.player].hand;
      if (action.play === "HM" && hand.HM <= 0) {
        return { state, events: [] };
      }
      if (
        (action.play === "SR" || action.play === "LR" || action.play === "SP" || action.play === "LP" || action.play === "TP") &&
        hand[action.play] <= 0
      ) {
        return { state, events: [] };
      }
      // Reject re-picks for the same side in the same play.
      if (isOffensiveCall && state.pendingPick.offensePlay) {
        return { state, events: [] };
      }
      if (!isOffensiveCall && state.pendingPick.defensePlay) {
        return { state, events: [] };
      }

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

        // 2-point conversion: PICK_PLAY in TWO_PT_CONV phase routes to a
        // dedicated resolver (different scoring + transition than regular
        // play). Restricted to regular plays — engine intentionally
        // doesn't allow HM/TP exotic flows on the conversion.
        if (
          state.phase === "TWO_PT_CONV" &&
          isRegularPlay(pendingPick.offensePlay) &&
          isRegularPlay(pendingPick.defensePlay)
        ) {
          const tp = resolveTwoPointConversion(
            stateWithPick,
            pendingPick.offensePlay,
            pendingPick.defensePlay,
            rng,
          );
          return { state: tp.state, events: [...events, ...tp.events] };
        }

        // Hail Mary by offense — resolves immediately, defense pick ignored.
        if (pendingPick.offensePlay === "HM") {
          const hm = resolveHailMary(stateWithPick, rng);
          return { state: hm.state, events: [...events, ...hm.events] };
        }

        // Trick Play by either side. v5.1 (run.js:1886): if both pick TP,
        // Same Play coin always triggers — falls through to Same Play below.
        if (
          pendingPick.offensePlay === "TP" &&
          pendingPick.defensePlay !== "TP"
        ) {
          const tp = resolveOffensiveTrickPlay(stateWithPick, rng);
          return { state: tp.state, events: [...events, ...tp.events] };
        }
        if (
          pendingPick.defensePlay === "TP" &&
          pendingPick.offensePlay !== "TP"
        ) {
          const tp = resolveDefensiveTrickPlay(stateWithPick, rng);
          return { state: tp.state, events: [...events, ...tp.events] };
        }
        if (pendingPick.offensePlay === "TP" && pendingPick.defensePlay === "TP") {
          // Both TP → Same Play unconditionally.
          const sp = resolveSamePlay(stateWithPick, rng);
          return { state: sp.state, events: [...events, ...sp.events] };
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
      // 3OT+ requires 2-point conversion. Silently substitute even if "kick"
      // was sent (matches v5.1's "must" behavior at run.js:1641).
      const effectiveChoice =
        state.overtime && state.overtime.period >= 3
          ? "two_point"
          : action.choice;
      if (effectiveChoice === "kick") {
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
        const otClock = { ...state.clock, quarter: 5, secondsRemaining: 0 };
        const ot = startOvertime({ ...state, clock: otClock });
        events.push(...ot.events);
        return { state: ot.state, events };
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
