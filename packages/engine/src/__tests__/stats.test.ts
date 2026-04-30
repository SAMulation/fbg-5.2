/**
 * Stats writing — passYards / rushYards / turnovers / sacks tracked on
 * each PlayerState as plays resolve. v5.1 had placeholder Stat objects but
 * never wrote to them; engine fills them so harness audits can assert
 * statistical properties (e.g. "every yard gained came from somewhere").
 */

import { describe, expect, it } from "vitest";
import { resolveRegularPlay } from "../rules/play.js";
import { resolveHailMary } from "../rules/specials/hailMary.js";
import { resolveBigPlay } from "../rules/specials/bigPlay.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (
  ballOn = 50,
  firstDownAt = 60,
  down: 1 | 2 | 3 | 4 = 1,
): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "REG_PLAY",
    field: { ballOn, firstDownAt, down, offense: 1 },
  };
};

// Deterministic rng — picks the FIRST slot for both decks (multiplier
// index 0 = King, yards index 0 = card-value 1). Resulting plays produce
// small positive yardage so the sign of the bookkeeping is testable.
const forcedRng = (d6: 1 | 2 | 3 | 4 | 5 | 6 = 4): Rng => ({
  intBetween: (min) => min,
  coinFlip: () => "heads",
  d6: () => d6,
});

describe("Stats writing", () => {
  it("a Short Pass play writes passYards (offense), zero for defense", () => {
    const r = resolveRegularPlay(
      s(50),
      { offensePlay: "SP", defensePlay: "SR" },
      forcedRng(),
    );
    // SP vs SR is matchup quality 3 (offense slightly ahead).
    expect(r.state.players[1].stats.rushYards).toBe(0);
    expect(r.state.players[1].stats.passYards).toBeGreaterThan(0);
    expect(r.state.players[2].stats.passYards).toBe(0);
    expect(r.state.players[2].stats.rushYards).toBe(0);
  });

  it("a Short Run play writes rushYards, not passYards", () => {
    const r = resolveRegularPlay(
      s(50),
      { offensePlay: "SR", defensePlay: "LP" },
      forcedRng(),
    );
    expect(r.state.players[1].stats.rushYards).toBeGreaterThan(0);
    expect(r.state.players[1].stats.passYards).toBe(0);
  });

  it("turnover on downs increments turnovers for offense", () => {
    // 4th & 50 — no realistic gain crosses the sticks → turnover on downs.
    const r = resolveRegularPlay(
      s(20, 70, 4),
      { offensePlay: "SR", defensePlay: "SR" },
      forcedRng(),
    );
    expect(r.events.some((e) => e.type === "TURNOVER_ON_DOWNS")).toBe(true);
    expect(r.state.players[1].stats.turnovers).toBe(1);
    expect(r.state.players[2].stats.turnovers).toBe(0);
  });

  it("Hail Mary interception (die=5) records an offense turnover", () => {
    const r = resolveHailMary(s(50), forcedRng(5));
    expect(r.state.players[1].stats.turnovers).toBe(1);
  });

  it("Hail Mary big-sack (die=1) records a sack and -10 pass yards", () => {
    const r = resolveHailMary(s(50), forcedRng(1));
    expect(r.state.players[1].stats.sacks).toBe(1);
    expect(r.state.players[1].stats.passYards).toBe(-10);
  });

  it("Hail Mary touchdown (die=6) credits passYards = yards-to-goal", () => {
    const r = resolveHailMary(s(70), forcedRng(6));
    expect(r.events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
    expect(r.state.players[1].stats.passYards).toBe(30);
  });

  it("Big Play defensive fumble (die=4) records offense turnover", () => {
    const r = resolveBigPlay(s(50), 2, forcedRng(4));
    expect(r.events.some((e) => e.type === "TURNOVER")).toBe(true);
    expect(r.state.players[1].stats.turnovers).toBe(1);
  });

  it("Big Play defensive fumble TD (die=6) records offense turnover", () => {
    const r = resolveBigPlay(s(50), 2, forcedRng(6));
    expect(r.state.players[1].stats.turnovers).toBe(1);
  });
});
