/**
 * Card-deck draws — pure versions of v5.1's `Game.decMults` and `Game.decYards`.
 *
 * The deck is represented as an array of remaining counts per card slot.
 * To draw, we pick a uniform random slot; if that slot is empty, we retry.
 * This is mathematically equivalent to shuffling the remaining cards and
 * drawing one — and matches v5.1's behavior verbatim.
 *
 * When the deck is exhausted, the consumer (the reducer) refills it and
 * emits a DECK_SHUFFLED event.
 */

import type { Rng } from "../rng.js";
import type { DeckState } from "../types.js";
import {
  freshDeckMultipliers,
  freshDeckYards,
} from "../state.js";
import {
  MULTIPLIER_CARD_NAMES,
  type MultiplierCardIndex,
  type MultiplierCardName,
} from "./yardage.js";

export interface MultiplierDraw {
  card: MultiplierCardName;
  index: MultiplierCardIndex;
  deck: DeckState;
  reshuffled: boolean;
}

export function drawMultiplier(deck: DeckState, rng: Rng): MultiplierDraw {
  const mults = [...deck.multipliers] as [number, number, number, number];

  let index: MultiplierCardIndex;
  // Rejection-sample to draw uniformly across remaining cards.
  // Loop is bounded — total cards in fresh deck is 15.
  for (;;) {
    const i = rng.intBetween(0, 3) as MultiplierCardIndex;
    if (mults[i] > 0) {
      index = i;
      break;
    }
  }

  mults[index]--;

  let reshuffled = false;
  let nextDeck: DeckState = { ...deck, multipliers: mults };
  if (mults.every((c) => c === 0)) {
    reshuffled = true;
    nextDeck = { ...nextDeck, multipliers: freshDeckMultipliers() };
  }

  return {
    card: MULTIPLIER_CARD_NAMES[index],
    index,
    deck: nextDeck,
    reshuffled,
  };
}

export interface YardsDraw {
  /** Yards card value, 1-10. */
  card: number;
  deck: DeckState;
  reshuffled: boolean;
}

export function drawYards(deck: DeckState, rng: Rng): YardsDraw {
  const yards = [...deck.yards];

  let index: number;
  for (;;) {
    const i = rng.intBetween(0, yards.length - 1);
    const slot = yards[i];
    if (slot !== undefined && slot > 0) {
      index = i;
      break;
    }
  }

  yards[index] = (yards[index] ?? 0) - 1;

  let reshuffled = false;
  let nextDeck: DeckState = { ...deck, yards };
  if (yards.every((c) => c === 0)) {
    reshuffled = true;
    nextDeck = { ...nextDeck, yards: freshDeckYards() };
  }

  return {
    card: index + 1,
    deck: nextDeck,
    reshuffled,
  };
}
