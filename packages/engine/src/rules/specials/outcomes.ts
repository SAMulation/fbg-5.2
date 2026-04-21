/**
 * Pure outcome-table helpers for special plays. These are extracted
 * from the full resolvers so that consumers (like v5.1's async code
 * paths) can look up the rule outcome without running the engine's
 * state transition.
 *
 * Once Phase 2 collapses the orchestrator into `engine.reduce`, these
 * helpers become an internal implementation detail. Until then, they
 * let v5.1 use the engine as the source of truth for game rules while
 * keeping its imperative flow.
 */

import type { MultiplierCardName } from "../yardage.js";
import type { PlayerId } from "../../types.js";

// ---------- Same Play ---------------------------------------------------------

export type SamePlayOutcome =
  | { kind: "big_play"; beneficiary: "offense" | "defense" }
  | { kind: "multiplier"; value: number; drawYards: boolean }
  | { kind: "interception" }
  | { kind: "no_gain" };

/**
 * v5.1's Same Play table (run.js:1899).
 *
 *   King    → Big Play (offense if heads, defense if tails)
 *   Queen + heads → +3x multiplier (draw yards)
 *   Queen + tails → 0x multiplier (no yards, no gain)
 *   Jack  + heads → 0x multiplier
 *   Jack  + tails → -3x multiplier (draw yards)
 *   10    + heads → INTERCEPTION
 *   10    + tails → 0 yards (no mechanic)
 */
export function samePlayOutcome(
  card: MultiplierCardName,
  coin: "heads" | "tails",
): SamePlayOutcome {
  const heads = coin === "heads";
  if (card === "King") return { kind: "big_play", beneficiary: heads ? "offense" : "defense" };
  if (card === "10") return heads ? { kind: "interception" } : { kind: "no_gain" };
  if (card === "Queen") {
    return heads
      ? { kind: "multiplier", value: 3, drawYards: true }
      : { kind: "multiplier", value: 0, drawYards: false };
  }
  // Jack
  return heads
    ? { kind: "multiplier", value: 0, drawYards: false }
    : { kind: "multiplier", value: -3, drawYards: true };
}

// ---------- Trick Play --------------------------------------------------------

export type TrickPlayOutcome =
  | { kind: "big_play"; beneficiary: PlayerId }
  | { kind: "penalty"; rawYards: number }
  | { kind: "multiplier"; value: number }
  | { kind: "overlay"; play: "LP" | "LR"; bonus: number };

/**
 * v5.1's Trick Play table (run.js:1987). Caller = player who called the
 * Trick Play (offense or defense). Die roll outcomes (from caller's POV):
 *
 *   1 → overlay LP with +5 bonus (signs flip for defensive caller)
 *   2 → 15-yard penalty on opponent
 *   3 → fixed -3x multiplier, draw yards
 *   4 → fixed +4x multiplier, draw yards
 *   5 → Big Play for caller
 *   6 → overlay LR with +5 bonus
 *
 * `rawYards` on penalty is signed from offense POV: positive = gain for
 * offense (offensive Trick Play roll=2), negative = loss (defensive).
 */
export function trickPlayOutcome(
  caller: PlayerId,
  offense: PlayerId,
  die: 1 | 2 | 3 | 4 | 5 | 6,
): TrickPlayOutcome {
  const callerIsOffense = caller === offense;

  if (die === 5) return { kind: "big_play", beneficiary: caller };

  if (die === 2) {
    const rawYards = callerIsOffense ? 15 : -15;
    return { kind: "penalty", rawYards };
  }

  if (die === 3) return { kind: "multiplier", value: -3 };
  if (die === 4) return { kind: "multiplier", value: 4 };

  // die 1 or 6
  const play = die === 1 ? "LP" : "LR";
  const bonus = callerIsOffense ? 5 : -5;
  return { kind: "overlay", play, bonus };
}

// ---------- Big Play ----------------------------------------------------------

export type BigPlayOutcome =
  | { kind: "offense_gain"; yards: number }
  | { kind: "offense_td" }
  | { kind: "defense_penalty"; rawYards: number }
  | { kind: "defense_fumble_return"; yards: number }
  | { kind: "defense_fumble_td" };

/**
 * v5.1's Big Play table (run.js:1933). beneficiary = who benefits
 * (offense or defense).
 *
 * Offense:
 *   1-3 → +25 yards
 *   4-5 → max(half-to-goal, 40)
 *   6   → TD
 * Defense:
 *   1-3 → 10-yard penalty on offense (repeat down)
 *   4-5 → fumble, defense returns max(half-to-goal, 25)
 *   6   → fumble, defensive TD
 */
export function bigPlayOutcome(
  beneficiary: PlayerId,
  offense: PlayerId,
  die: 1 | 2 | 3 | 4 | 5 | 6,
  /** ballOn from offense POV (0-100). */
  ballOn: number,
): BigPlayOutcome {
  const benefitsOffense = beneficiary === offense;

  if (benefitsOffense) {
    if (die === 6) return { kind: "offense_td" };
    if (die <= 3) return { kind: "offense_gain", yards: 25 };
    const halfToGoal = Math.round((100 - ballOn) / 2);
    return { kind: "offense_gain", yards: halfToGoal > 40 ? halfToGoal : 40 };
  }

  // Defense beneficiary
  if (die <= 3) {
    const rawYards = ballOn - 10 < 1 ? -Math.floor(ballOn / 2) : -10;
    return { kind: "defense_penalty", rawYards };
  }
  if (die === 6) return { kind: "defense_fumble_td" };
  const halfToGoal = Math.round((100 - ballOn) / 2);
  return { kind: "defense_fumble_return", yards: halfToGoal > 25 ? halfToGoal : 25 };
}
