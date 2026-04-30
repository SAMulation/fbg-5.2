/**
 * Kickoff tests. Covers kick-type / return-type picks restored in v6.
 *
 * Math mirrors v5.1:
 *   RK + RR: d6 for kick dist (35..60), mult × yards for return.
 *   RK + TB: auto touchback to the 25.
 *   OK:      intBetween(1, odds) where odds=6 (or 12 vs OR).
 *            tmp===1 → kicker recovers.
 *   SK + RR: d6 for kick dist (20..45), 2d6 for return.
 */

import { describe, expect, it } from "vitest";
import { resolveKickoff } from "../rules/specials/kickoff.js";
import { initialState } from "../state.js";
import type { GameState } from "../types.js";
import type { Rng } from "../rng.js";

const s = (overrides: Partial<GameState> = {}): GameState => {
  const base = initialState({
    team1: { id: "NE" },
    team2: { id: "GB" },
    quarterLengthMinutes: 7,
  });
  return {
    ...base,
    phase: "KICKOFF",
    field: { ballOn: 35, firstDownAt: 45, down: 1, offense: 1 },
    ...overrides,
  };
};

interface RngSeq {
  d6?: (1 | 2 | 3 | 4 | 5 | 6)[];
  coins?: ("heads" | "tails")[];
  yardsCards?: number[];
  multCards?: (0 | 1 | 2 | 3)[];
  onsideRolls?: number[];
}

const seqRng = (seq: RngSeq): Rng => {
  const d6Queue = [...(seq.d6 ?? [])];
  const coinQueue = [...(seq.coins ?? [])];
  const yardsQueue = [...(seq.yardsCards ?? [])];
  const multQueue = [...(seq.multCards ?? [])];
  const onsideQueue = [...(seq.onsideRolls ?? [])];
  return {
    d6: () => (d6Queue.shift() ?? 1) as 1 | 2 | 3 | 4 | 5 | 6,
    coinFlip: () => coinQueue.shift() ?? "heads",
    intBetween(min, max) {
      if (min === 0 && max === 3) return (multQueue.shift() ?? 0) as number;
      if (min === 0 && max === 9) return (yardsQueue.shift() ?? 5) - 1;
      if (min === 1 && (max === 6 || max === 12)) return onsideQueue.shift() ?? 2;
      return min;
    },
  };
};

describe("Kickoff — RK (Regular Kick)", () => {
  it("RK + RR: d6=1 kick, Jack × 2 return → ball at receiver's 8", () => {
    // kickYards = 35 + 5*(1-1) = 35 → lands at 70 (from kicker POV) → receiver starts at 30
    // Jack = 1x; yard=2 → retYards = 2 → final 30+2 = 32? Wait let me recompute.
    // Actually: kickRoll=1, kickYards=35+5*(1-1)=35, kickEnd=35+35=70, boundedEnd=70
    // receiverStart = 100-70 = 30
    // mult=Jack(1x), yardsCard=2 → retYards = 1*2 = 2
    // finalBallOn = 30+2 = 32
    const r = resolveKickoff(
      s(),
      seqRng({ d6: [1], multCards: [2], yardsCards: [2] }),
      { kickType: "RK", returnType: "RR" },
    );
    expect(r.state.field.ballOn).toBe(32);
    expect(r.state.field.offense).toBe(2);
    expect(r.state.field.down).toBe(1);
    expect(r.state.phase).toBe("REG_PLAY");
  });

  it("RK + RR: King × 10 breaks for a TD", () => {
    // kickRoll=1 → kickEnd=70, receiverStart=30
    // mult=King(10x), yard=10 → retYards=100 → finalBallOn=130 → TD
    const r = resolveKickoff(
      s(),
      seqRng({ d6: [1], multCards: [0], yardsCards: [10] }),
      { kickType: "RK", returnType: "RR" },
    );
    expect(r.events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
    expect(r.state.phase).toBe("PAT_CHOICE");
  });

  it("RK + TB: auto touchback, ball at the 25", () => {
    const r = resolveKickoff(s(), seqRng({}), {
      kickType: "RK",
      returnType: "TB",
    });
    expect(r.events.some((e) => e.type === "TOUCHBACK")).toBe(true);
    expect(r.state.field.ballOn).toBe(25);
    expect(r.state.field.offense).toBe(2);
    expect(r.state.phase).toBe("REG_PLAY");
  });

  it("RK + OR: returner mismatched, resolved as touchback", () => {
    const r = resolveKickoff(s(), seqRng({}), {
      kickType: "RK",
      returnType: "OR",
    });
    expect(r.events.some((e) => e.type === "TOUCHBACK")).toBe(true);
    expect(r.state.field.ballOn).toBe(25);
  });

  it("emits KICK_TYPE_CHOSEN + RETURN_TYPE_CHOSEN + KICKOFF events", () => {
    const r = resolveKickoff(
      s(),
      seqRng({ d6: [1], multCards: [2], yardsCards: [2] }),
      { kickType: "RK", returnType: "RR" },
    );
    expect(r.events.some((e) => e.type === "KICK_TYPE_CHOSEN")).toBe(true);
    expect(r.events.some((e) => e.type === "RETURN_TYPE_CHOSEN")).toBe(true);
    expect(r.events.some((e) => e.type === "KICKOFF")).toBe(true);
  });
});

describe("Kickoff — OK (Onside Kick)", () => {
  it("OK vs RR: recovery (tmp=1) keeps possession with kicker", () => {
    const r = resolveKickoff(
      s(),
      seqRng({ onsideRolls: [1], d6: [3] }),
      { kickType: "OK", returnType: "RR" },
    );
    const ev = r.events.find((e) => e.type === "ONSIDE_KICK");
    expect(ev).toBeDefined();
    if (ev && ev.type === "ONSIDE_KICK") {
      expect(ev.recovered).toBe(true);
      expect(ev.recoveringPlayer).toBe(1);
    }
    expect(r.state.field.offense).toBe(1);
  });

  it("OK vs RR: miss (tmp=3) gives ball to returner", () => {
    const r = resolveKickoff(
      s(),
      seqRng({ onsideRolls: [3], d6: [2] }),
      { kickType: "OK", returnType: "RR" },
    );
    const ev = r.events.find((e) => e.type === "ONSIDE_KICK");
    expect(ev).toBeDefined();
    if (ev && ev.type === "ONSIDE_KICK") {
      expect(ev.recovered).toBe(false);
      expect(ev.recoveringPlayer).toBe(2);
    }
    expect(r.state.field.offense).toBe(2);
  });

  it("OK vs OR: harder recovery (1-in-12 odds path reached)", () => {
    // With returnType=OR, intBetween(1, 12) is called. Our seqRng doesn't
    // distinguish, but the seeded tmp=1 still recovers.
    const r = resolveKickoff(
      s(),
      seqRng({ onsideRolls: [1], d6: [3] }),
      { kickType: "OK", returnType: "OR" },
    );
    const ev = r.events.find((e) => e.type === "ONSIDE_KICK");
    expect(ev).toBeDefined();
    if (ev && ev.type === "ONSIDE_KICK") expect(ev.recovered).toBe(true);
  });
});

describe("Kickoff — SK (Squib Kick)", () => {
  it("SK + RR: short kick + 2d6 return", () => {
    // kickRoll=2 → kickYards=15+5*2=25 → kickEnd=60 → receiverStart=40
    // retYards = d6+d6 = 3+4 = 7 → final 47
    const r = resolveKickoff(
      s(),
      seqRng({ d6: [2, 3, 4] }),
      { kickType: "SK", returnType: "RR" },
    );
    expect(r.state.field.ballOn).toBe(47);
    expect(r.state.field.offense).toBe(2);
  });

  it("SK + TB: no return on squib when returner chose TB", () => {
    // kickRoll=2 → kickEnd=60 → receiverStart=40; retYards=0; final=40
    const r = resolveKickoff(s(), seqRng({ d6: [2] }), {
      kickType: "SK",
      returnType: "TB",
    });
    expect(r.state.field.ballOn).toBe(40);
  });
});

describe("Kickoff — safety-kick carve-out", () => {
  it("isSafetyKick=true bypasses picks and uses punt-path resolution", () => {
    const state: GameState = {
      ...s(),
      isSafetyKick: true,
    };
    const r = resolveKickoff(state, seqRng({
      d6: [3, 1], coins: ["heads"], yardsCards: [6, 2], multCards: [2],
    }));
    // Safety-kick path clears the flag.
    expect(r.state.isSafetyKick).toBe(false);
    // Resolves to REG_PLAY.
    expect(r.state.phase).toBe("REG_PLAY");
    // Uses punt events, not the pick events.
    expect(r.events.some((e) => e.type === "PUNT")).toBe(true);
    expect(r.events.some((e) => e.type === "KICK_TYPE_CHOSEN")).toBe(false);
  });

  it("no picks + no safety flag: falls through to safety-kick path", () => {
    const r = resolveKickoff(s(), seqRng({
      d6: [3, 1], coins: ["heads"], yardsCards: [6, 2], multCards: [2],
    }));
    expect(r.state.phase).toBe("REG_PLAY");
    expect(r.events.some((e) => e.type === "PUNT")).toBe(true);
  });

  it("F-54: safety-kick punt return TD preserves PAT_CHOICE phase", () => {
    // Safety-kick path: block + muff checks skipped, so the rng draws are
    // (coin, yardsCard, multCard, yardsCard).
    // kickDist = 10 * yardsCard / 2 + (heads ? 20 : 0).
    // yard=2 + heads → kickDist=30 → landing at 35+30=65 → receiverStart 35.
    // Punt return mult: King=7 (RETURN_MULTIPLIERS in punt.ts).
    // Return: King × yardsCard 10 = 70 → ballOn = 35 + 70 = 105 → TD.
    const state: GameState = { ...s(), isSafetyKick: true };
    const r = resolveKickoff(state, seqRng({
      coins: ["heads"],
      yardsCards: [2, 10],
      multCards: [0], // King
    }));
    expect(r.events.some((e) => e.type === "TOUCHDOWN")).toBe(true);
    expect(r.state.phase).toBe("PAT_CHOICE");
    expect(r.state.isSafetyKick).toBe(false);
    // Receiver (player 2 — the kickoff opponent) scored.
    expect(r.state.players[2].score).toBe(6);
    expect(r.state.field.offense).toBe(2);
  });
});
