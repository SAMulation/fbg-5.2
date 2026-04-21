/**
 * RNG abstraction.
 *
 * The engine never reaches for `Math.random()` directly. All randomness is
 * sourced from an `Rng` instance passed into `reduce()`. This is what makes
 * the engine deterministic and testable.
 *
 * In production, the Supabase Edge Function creates a seeded RNG per game
 * (seed stored alongside game state), so a complete game can be replayed
 * deterministically from its action log — useful for bug reports, recap
 * generation, and "watch the game back" features.
 */

export interface Rng {
  /** Inclusive both ends. */
  intBetween(minInclusive: number, maxInclusive: number): number;
  /** Returns "heads" or "tails". */
  coinFlip(): "heads" | "tails";
  /** Returns 1-6. */
  d6(): 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Mulberry32 — a small, fast, well-distributed seeded PRNG. Sufficient for
 * a card-drawing football game; not for cryptography.
 */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    intBetween(min, max) {
      return Math.floor(next() * (max - min + 1)) + min;
    },
    coinFlip() {
      return next() < 0.5 ? "heads" : "tails";
    },
    d6() {
      return (Math.floor(next() * 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    },
  };
}
