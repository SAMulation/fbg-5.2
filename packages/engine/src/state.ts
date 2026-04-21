/**
 * State factories.
 *
 * `initialState()` produces a fresh GameState in INIT phase. Everything else
 * flows from reducing actions over this starting point.
 */

import type { GameState, Hand, PlayerId, Stats, TeamRef } from "./types.js";

export function emptyHand(isOvertime = false): Hand {
  return {
    SR: 3,
    LR: 3,
    SP: 3,
    LP: 3,
    TP: 1,
    HM: isOvertime ? 2 : 3,
  };
}

export function emptyStats(): Stats {
  return { passYards: 0, rushYards: 0, turnovers: 0, sacks: 0 };
}

export function freshDeckMultipliers(): [number, number, number, number] {
  return [4, 4, 4, 3];
}

export function freshDeckYards(): number[] {
  return [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
}

export interface InitialStateArgs {
  team1: TeamRef;
  team2: TeamRef;
  quarterLengthMinutes: number;
}

export function initialState(args: InitialStateArgs): GameState {
  return {
    phase: "INIT",
    schemaVersion: 1,
    clock: {
      quarter: 0,
      secondsRemaining: args.quarterLengthMinutes * 60,
      quarterLengthMinutes: args.quarterLengthMinutes,
    },
    field: {
      ballOn: 35,
      firstDownAt: 45,
      down: 1,
      offense: 1,
    },
    deck: {
      multipliers: freshDeckMultipliers(),
      yards: freshDeckYards(),
    },
    players: {
      1: {
        team: args.team1,
        score: 0,
        timeouts: 3,
        hand: emptyHand(),
        stats: emptyStats(),
      },
      2: {
        team: args.team2,
        score: 0,
        timeouts: 3,
        hand: emptyHand(),
        stats: emptyStats(),
      },
    },
    openingReceiver: null,
    overtime: null,
    pendingPick: { offensePlay: null, defensePlay: null },
    lastPlayDescription: "Start of game",
  };
}

export function opp(p: PlayerId): PlayerId {
  return p === 1 ? 2 : 1;
}
