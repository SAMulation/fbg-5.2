/**
 * The play matchup matrix — the heart of FootBored.
 *
 * Both teams pick a play. The matrix scores how *closely* the defense
 * predicted the offensive call:
 *   - 1 = defense way off → great for offense
 *   - 5 = defense matched → terrible for offense (combined with a low
 *         multiplier card, this becomes a loss / turnover risk)
 *
 * Rows = offensive call, Cols = defensive call. Order: [SR, LR, SP, LP].
 *
 *           DEF: SR  LR  SP  LP
 *   OFF: SR     [ 5,  3,  3,  2 ]
 *   OFF: LR     [ 2,  4,  1,  2 ]
 *   OFF: SP     [ 3,  2,  5,  3 ]
 *   OFF: LP     [ 1,  2,  2,  4 ]
 *
 * Ported verbatim from public/js/defaults.js MATCHUP. Indexing confirmed
 * against playMechanism / calcTimes in run.js:2368.
 */

import type { RegularPlay } from "../types.js";

export const MATCHUP: ReadonlyArray<ReadonlyArray<MatchupQuality>> = [
  [5, 3, 3, 2],
  [2, 4, 1, 2],
  [3, 2, 5, 3],
  [1, 2, 2, 4],
] as const;

export type MatchupQuality = 1 | 2 | 3 | 4 | 5;

const PLAY_INDEX: Record<RegularPlay, 0 | 1 | 2 | 3> = {
  SR: 0,
  LR: 1,
  SP: 2,
  LP: 3,
};

/**
 * Multiplier card values. Indexing (confirmed in run.js:2377):
 *   row    = multiplier card (0=King, 1=Queen, 2=Jack, 3=10)
 *   column = matchup quality - 1 (so column 0 = quality 1, column 4 = quality 5)
 *
 * Quality 1 (offense outguessed defense) + King = 4x. Best possible play.
 * Quality 5 (defense matched) + 10        = -1x. Worst regular play.
 *
 *                  qual 1  qual 2  qual 3  qual 4  qual 5
 *   King    (0)  [   4,      3,      2,     1.5,     1   ]
 *   Queen   (1)  [   3,      2,      1,      1,     0.5  ]
 *   Jack    (2)  [   2,      1,     0.5,     0,      0   ]
 *   10      (3)  [   0,      0,      0,     -1,     -1   ]
 *
 * Ported verbatim from public/js/defaults.js MULTI.
 */
export const MULTI: ReadonlyArray<ReadonlyArray<number>> = [
  [4, 3, 2, 1.5, 1],
  [3, 2, 1, 1, 0.5],
  [2, 1, 0.5, 0, 0],
  [0, 0, 0, -1, -1],
] as const;

export function matchupQuality(off: RegularPlay, def: RegularPlay): MatchupQuality {
  const row = MATCHUP[PLAY_INDEX[off]];
  if (!row) throw new Error(`unreachable: bad off play ${off}`);
  const q = row[PLAY_INDEX[def]];
  if (q === undefined) throw new Error(`unreachable: bad def play ${def}`);
  return q;
}
