/**
 * Pure yardage calculation for a regular play (SR/LR/SP/LP).
 *
 * Formula (run.js:2337):
 *   yards = round(multiplier * yardsCard) + bonus
 *
 * Where:
 *   - multiplier = MULTI[multiplierCard][quality - 1]
 *   - quality    = MATCHUP[offense][defense]   // 1-5
 *   - bonus      = special-play bonus (e.g. Trick Play +5 on LR/LP outcomes)
 *
 * Special plays (TP, HM, FG, PUNT, TWO_PT) use different formulas — they
 * live in rules/special.ts (TODO) and produce events directly.
 */

import type { RegularPlay } from "../types.js";
import { MULTI, matchupQuality } from "./matchup.js";

export type MultiplierCardIndex = 0 | 1 | 2 | 3;
export const MULTIPLIER_CARD_NAMES = ["King", "Queen", "Jack", "10"] as const;
export type MultiplierCardName = (typeof MULTIPLIER_CARD_NAMES)[number];

export interface YardageInputs {
  offense: RegularPlay;
  defense: RegularPlay;
  /** Multiplier card index: 0=King, 1=Queen, 2=Jack, 3=10. */
  multiplierCard: MultiplierCardIndex;
  /** Yards card drawn, 1-10. */
  yardsCard: number;
  /** Bonus yards from special-play overlays (e.g. Trick Play +5). */
  bonus?: number;
}

export interface YardageOutcome {
  matchupQuality: number;
  multiplier: number;
  multiplierCardName: MultiplierCardName;
  yardsGained: number;
}

export function computeYardage(inputs: YardageInputs): YardageOutcome {
  const quality = matchupQuality(inputs.offense, inputs.defense);
  const multiRow = MULTI[inputs.multiplierCard];
  if (!multiRow) throw new Error(`unreachable: bad multi card ${inputs.multiplierCard}`);
  const multiplier = multiRow[quality - 1];
  if (multiplier === undefined) throw new Error(`unreachable: bad quality ${quality}`);

  const bonus = inputs.bonus ?? 0;
  const yardsGained = Math.round(multiplier * inputs.yardsCard) + bonus;

  return {
    matchupQuality: quality,
    multiplier,
    multiplierCardName: MULTIPLIER_CARD_NAMES[inputs.multiplierCard],
    yardsGained,
  };
}
