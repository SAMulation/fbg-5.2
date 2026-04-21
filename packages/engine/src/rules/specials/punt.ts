/**
 * Punt (run.js:2090). Also serves for safety kicks.
 *
 * Sequence (all randomness through rng):
 *   1. Block check: if initial d6 is 6, roll again — 2-sixes = blocked (1/36).
 *   2. If not blocked, draw yards card + coin flip:
 *        kickDist = 10 * yardsCard / 2 + 20 * (coin=heads ? 1 : 0)
 *      Resulting range: [5, 70] yards.
 *   3. If ball lands past 100 → touchback, place at receiver's 20.
 *   4. Muff check (not on touchback/block/safety kick): 2-sixes = receiver
 *      muffs, kicking team recovers.
 *   5. Return: if possession, draw multCard + yards.
 *        King=7x, Queen=4x, Jack=1x, 10=-0.5x
 *        return = round(mult * yardsCard)
 *      Return can score TD or concede safety.
 *
 * For the engine port: this is the most procedural of the specials. We
 * collect events in order and produce one final state.
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState } from "../../types.js";
import { opp } from "../../state.js";
import { drawMultiplier, drawYards } from "../deck.js";
import {
  applySafety,
  applyTouchdown,
  blankPick,
  type SpecialResolution,
} from "./shared.js";

const RETURN_MULTIPLIERS: Record<"King" | "Queen" | "Jack" | "10", number> = {
  King: 7,
  Queen: 4,
  Jack: 1,
  "10": -0.5,
};

export interface PuntOptions {
  /** true if this is a safety kick (no block/muff checks). */
  safetyKick?: boolean;
}

export function resolvePunt(
  state: GameState,
  rng: Rng,
  opts: PuntOptions = {},
): SpecialResolution {
  const offense = state.field.offense;
  const defender = opp(offense);
  const events: Event[] = [];
  let deck = state.deck;

  // Block check (not on safety kick).
  let blocked = false;
  if (!opts.safetyKick) {
    if (rng.d6() === 6 && rng.d6() === 6) {
      blocked = true;
    }
  }

  if (blocked) {
    // Kicking team loses possession at the line of scrimmage.
    const mirroredBallOn = 100 - state.field.ballOn;
    events.push({ type: "PUNT", player: offense, landingSpot: state.field.ballOn });
    events.push({ type: "TURNOVER", reason: "fumble" });
    return {
      state: {
        ...state,
        pendingPick: blankPick(),
        field: {
          ballOn: mirroredBallOn,
          firstDownAt: Math.min(100, mirroredBallOn + 10),
          down: 1,
          offense: defender,
        },
      },
      events,
    };
  }

  // Draw yards + coin for kick distance.
  const coin = rng.coinFlip();
  const yardsDraw = drawYards(deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  deck = yardsDraw.deck;

  const kickDist = (10 * yardsDraw.card) / 2 + (coin === "heads" ? 20 : 0);
  const landingSpot = state.field.ballOn + kickDist;
  const touchback = landingSpot > 100;
  events.push({ type: "PUNT", player: offense, landingSpot });

  // Muff check (not on touchback, block, safety kick).
  let muffed = false;
  if (!touchback && !opts.safetyKick) {
    if (rng.d6() === 6 && rng.d6() === 6) {
      muffed = true;
    }
  }

  if (muffed) {
    // Receiver muffs, kicking team recovers where the ball landed.
    // Kicking team retains possession (still offense).
    events.push({ type: "TURNOVER", reason: "fumble" });
    return {
      state: {
        ...state,
        deck,
        pendingPick: blankPick(),
        field: {
          ballOn: Math.min(99, landingSpot),
          firstDownAt: Math.min(100, landingSpot + 10),
          down: 1,
          offense, // kicker retains
        },
      },
      events,
    };
  }

  // Touchback: receiver gets ball at their own 20 (= 80 from their perspective,
  // but ball position is tracked from offense POV, so for the NEW offense that
  // is 100-80 = 20).
  if (touchback) {
    const stateAfterKick: GameState = { ...state, deck };
    return {
      state: {
        ...stateAfterKick,
        pendingPick: blankPick(),
        field: {
          ballOn: 20,
          firstDownAt: 30,
          down: 1,
          offense: defender,
        },
      },
      events,
    };
  }

  // Normal punt return: draw multCard + yards. Return measured from landingSpot.
  const multDraw = drawMultiplier(deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  deck = multDraw.deck;

  const returnDraw = drawYards(deck, rng);
  if (returnDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  deck = returnDraw.deck;

  const mult = RETURN_MULTIPLIERS[multDraw.card];
  const returnYards = Math.round(mult * returnDraw.card);

  // Ball ends up at landingSpot - returnYards (from kicking team's POV).
  // Equivalently, from the receiving team's POV: (100 - landingSpot) + returnYards.
  const receiverBallOn = 100 - landingSpot + returnYards;

  const stateAfterReturn: GameState = { ...state, deck };

  // Return TD — receiver scores.
  if (receiverBallOn >= 100) {
    const receiverBallClamped = 100;
    void receiverBallClamped;
    return applyTouchdown(
      { ...stateAfterReturn, field: { ...state.field, offense: defender } },
      defender,
      events,
    );
  }

  // Return safety — receiver tackled in their own endzone (can't actually
  // happen from a negative-return-yardage standpoint in v5.1 since start is
  // 100-landingSpot which is > 0, but model it anyway for completeness).
  if (receiverBallOn <= 0) {
    return applySafety(
      { ...stateAfterReturn, field: { ...state.field, offense: defender } },
      defender,
      events,
    );
  }

  return {
    state: {
      ...stateAfterReturn,
      pendingPick: blankPick(),
      field: {
        ballOn: receiverBallOn,
        firstDownAt: Math.min(100, receiverBallOn + 10),
        down: 1,
        offense: defender,
      },
    },
    events,
  };
}
