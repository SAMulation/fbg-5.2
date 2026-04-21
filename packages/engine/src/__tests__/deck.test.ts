/**
 * Card-deck mechanics. Critical that this matches v5.1 — yardage outputs
 * depend entirely on the distribution of cards drawn.
 */

import { describe, expect, it } from "vitest";
import { drawMultiplier, drawYards } from "../rules/deck.js";
import { freshDeckMultipliers, freshDeckYards } from "../state.js";
import { seededRng } from "../rng.js";
import type { DeckState } from "../types.js";

const fresh = (): DeckState => ({
  multipliers: freshDeckMultipliers(),
  yards: freshDeckYards(),
});

describe("drawMultiplier", () => {
  it("decrements the drawn slot", () => {
    const before = fresh();
    const { index, deck } = drawMultiplier(before, seededRng(1));
    const beforeCount = before.multipliers[index]!;
    const afterCount = deck.multipliers[index]!;
    expect(afterCount).toBe(beforeCount - 1);
  });

  it("never returns an exhausted slot", () => {
    let deck: DeckState = { ...fresh(), multipliers: [0, 0, 0, 1] };
    for (let i = 0; i < 100; i++) {
      const draw = drawMultiplier(deck, seededRng(i));
      expect(draw.index).toBe(3);
      // Drawing the last 10 reshuffles the multiplier deck.
      expect(draw.reshuffled).toBe(true);
      deck = { ...fresh(), multipliers: [0, 0, 0, 1] };
    }
  });

  it("reshuffles when entire deck exhausted", () => {
    const rng = seededRng(42);
    let deck = fresh();
    let totalDrawn = 0;
    let reshuffles = 0;
    while (totalDrawn < 16) {
      const result = drawMultiplier(deck, rng);
      deck = result.deck;
      totalDrawn++;
      if (result.reshuffled) reshuffles++;
    }
    // Fresh deck has 4+4+4+3 = 15 cards. After 15 draws → reshuffle.
    expect(reshuffles).toBeGreaterThanOrEqual(1);
    // After reshuffle, deck should be back to full.
    expect(deck.multipliers.reduce((a, b) => a + b, 0)).toBeGreaterThan(10);
  });

  it("is deterministic with a seeded RNG", () => {
    const a = drawMultiplier(fresh(), seededRng(7));
    const b = drawMultiplier(fresh(), seededRng(7));
    expect(a.index).toBe(b.index);
    expect(a.card).toBe(b.card);
  });
});

describe("drawYards", () => {
  it("returns cards in 1-10 range", () => {
    const rng = seededRng(99);
    let deck = fresh();
    for (let i = 0; i < 50; i++) {
      const r = drawYards(deck, rng);
      expect(r.card).toBeGreaterThanOrEqual(1);
      expect(r.card).toBeLessThanOrEqual(10);
      deck = r.deck;
    }
  });

  it("reshuffles after exactly 10 draws on fresh deck", () => {
    const rng = seededRng(123);
    let deck = fresh();
    let lastReshuffle = -1;
    for (let i = 0; i < 10; i++) {
      const r = drawYards(deck, rng);
      deck = r.deck;
      if (r.reshuffled) lastReshuffle = i;
    }
    expect(lastReshuffle).toBe(9); // the 10th draw exhausts the deck
  });
});
