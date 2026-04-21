/**
 * Overtime mechanics.
 *
 * College-football style:
 *   - Each period: each team gets one possession from the opponent's 25
 *     (offense POV: ballOn = 75).
 *   - A possession ends with: TD (followed by PAT/2pt), FG (made or missed),
 *     turnover, turnover-on-downs, or safety.
 *   - After both possessions, if scores differ → GAME_OVER. If tied → next
 *     period.
 *   - Periods alternate who possesses first.
 *   - Period 3+: 2-point conversion mandatory after a TD (no PAT kick).
 *   - Hail Marys: 2 per period, refilled at start of each period.
 *   - Timeouts: 1 per pair of periods.
 */

import type { Event } from "../events.js";
import type { GameState, OvertimeState, PlayerId } from "../types.js";
import { emptyHand, opp } from "../state.js";
import { freshDeckMultipliers, freshDeckYards } from "../state.js";

const OT_BALL_ON = 75; // opponent's 25-yard line, from offense POV

/**
 * Initialize OT state, refresh decks/hands, set ball at the 25.
 * Called once tied regulation ends.
 */
export function startOvertime(state: GameState): { state: GameState; events: Event[] } {
  const events: Event[] = [];
  const firstReceiver: PlayerId = state.openingReceiver === 1 ? 2 : 1;
  const overtime: OvertimeState = {
    period: 1,
    possession: firstReceiver,
    firstReceiver,
    possessionsRemaining: 2,
  };
  events.push({ type: "OVERTIME_STARTED", period: 1, possession: firstReceiver });
  return {
    state: {
      ...state,
      phase: "OT_START",
      overtime,
    },
    events,
  };
}

/** Begin (or resume) the next OT possession. */
export function startOvertimePossession(state: GameState): { state: GameState; events: Event[] } {
  if (!state.overtime) return { state, events: [] };

  const possession = state.overtime.possession;
  const events: Event[] = [];

  // Refill HM count for the possession's offense (matches v5.1: HM resets
  // per OT period). Period 3+ players have only 2 HMs anyway.
  const newPlayers = {
    ...state.players,
    [possession]: {
      ...state.players[possession],
      hand: { ...state.players[possession].hand, HM: state.overtime.period >= 3 ? 2 : 2 },
    },
  } as GameState["players"];

  return {
    state: {
      ...state,
      players: newPlayers,
      phase: "OT_PLAY",
      field: {
        ballOn: OT_BALL_ON,
        firstDownAt: Math.min(100, OT_BALL_ON + 10),
        down: 1,
        offense: possession,
      },
    },
    events,
  };
}

/**
 * End the current OT possession. Decrements possessionsRemaining; if 0,
 * checks for game end. Otherwise flips possession.
 *
 * Caller is responsible for detecting "this was a possession-ending event"
 * (TD+PAT, FG decision, turnover, etc).
 */
export function endOvertimePossession(state: GameState): { state: GameState; events: Event[] } {
  if (!state.overtime) return { state, events: [] };

  const events: Event[] = [];
  const remaining = state.overtime.possessionsRemaining;

  if (remaining === 2) {
    // First possession ended. Flip to second team, fresh ball.
    const nextPossession = opp(state.overtime.possession);
    const newPlayers = {
      ...state.players,
      [nextPossession]: {
        ...state.players[nextPossession],
        hand: { ...state.players[nextPossession].hand, HM: 2 },
      },
    } as GameState["players"];
    return {
      state: {
        ...state,
        players: newPlayers,
        phase: "OT_PLAY",
        overtime: { ...state.overtime, possession: nextPossession, possessionsRemaining: 1 },
        field: {
          ballOn: OT_BALL_ON,
          firstDownAt: Math.min(100, OT_BALL_ON + 10),
          down: 1,
          offense: nextPossession,
        },
      },
      events,
    };
  }

  // Second possession ended. Compare scores.
  const p1 = state.players[1].score;
  const p2 = state.players[2].score;
  if (p1 !== p2) {
    const winner: PlayerId = p1 > p2 ? 1 : 2;
    events.push({ type: "GAME_OVER", winner });
    return {
      state: {
        ...state,
        phase: "GAME_OVER",
        overtime: { ...state.overtime, possessionsRemaining: 0 },
      },
      events,
    };
  }

  // Tied — start next period. Alternates first-possessor.
  const nextPeriod = state.overtime.period + 1;
  const nextFirst = opp(state.overtime.firstReceiver);
  events.push({ type: "OVERTIME_STARTED", period: nextPeriod, possession: nextFirst });
  return {
    state: {
      ...state,
      phase: "OT_START",
      overtime: {
        period: nextPeriod,
        possession: nextFirst,
        firstReceiver: nextFirst,
        possessionsRemaining: 2,
      },
      // Fresh decks for the new period.
      deck: { multipliers: freshDeckMultipliers(), yards: freshDeckYards() },
      players: {
        ...state.players,
        1: { ...state.players[1], hand: emptyHand(true) },
        2: { ...state.players[2], hand: emptyHand(true) },
      },
    },
    events,
  };
}

/**
 * Detect whether a sequence of events from a play resolution should end
 * the current OT possession.
 */
export function isPossessionEndingInOT(events: ReadonlyArray<Event>): boolean {
  for (const e of events) {
    switch (e.type) {
      case "PAT_GOOD":
      case "TWO_POINT_GOOD":
      case "TWO_POINT_FAILED":
      case "FIELD_GOAL_GOOD":
      case "FIELD_GOAL_MISSED":
      case "TURNOVER":
      case "TURNOVER_ON_DOWNS":
      case "SAFETY":
        return true;
    }
  }
  return false;
}
