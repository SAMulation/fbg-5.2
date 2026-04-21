/**
 * RNG determinism — the load-bearing property of the entire engine.
 *
 * If two reduces with the same seed produce different outputs, all bets
 * are off for server-authoritative multiplayer.
 */

import { describe, expect, it } from "vitest";
import { seededRng } from "../rng.js";

describe("seededRng", () => {
  it("produces identical sequences for identical seeds", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const seqA = Array.from({ length: 100 }, () => a.intBetween(0, 999));
    const seqB = Array.from({ length: 100 }, () => b.intBetween(0, 999));
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = seededRng(1);
    const b = seededRng(2);
    const seqA = Array.from({ length: 50 }, () => a.intBetween(0, 999));
    const seqB = Array.from({ length: 50 }, () => b.intBetween(0, 999));
    expect(seqA).not.toEqual(seqB);
  });

  it("d6 returns values 1-6", () => {
    const rng = seededRng(7);
    for (let i = 0; i < 1000; i++) {
      const roll = rng.d6();
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    }
  });

  it("intBetween includes both endpoints", () => {
    const rng = seededRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(rng.intBetween(0, 3));
    expect(seen).toEqual(new Set([0, 1, 2, 3]));
  });
});
