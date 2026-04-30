/**
 * Kickoff. v6 restores v5.1's kick-type / return-type picks.
 *
 * The kicker (state.field.offense) chooses one of:
 *   RK — Regular Kick: long kick, mult+yards return
 *   OK — Onside Kick:  short kick, 1-in-6 recovery roll (1-in-12 vs OR)
 *   SK — Squib Kick:   medium kick, 2d6 return if receiver chose RR
 *
 * The returner chooses one of:
 *   RR — Regular Return: normal return
 *   OR — Onside counter: defends the onside (harder for kicker to recover)
 *   TB — Touchback:      take the ball at the 25
 *
 * Safety kicks (state.isSafetyKick=true) skip the picks and use the
 * existing simplified punt path.
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState, KickType, ReturnType } from "../../types.js";
import { opp } from "../../state.js";
import { drawMultiplier, drawYards } from "../deck.js";
import { resolvePunt } from "./punt.js";
import {
  applySafety,
  applyTouchdown,
  blankPick,
  type SpecialResolution,
} from "./shared.js";

const KICKOFF_MULTIPLIERS: Record<"King" | "Queen" | "Jack" | "10", number> = {
  King: 10,
  Queen: 5,
  Jack: 1,
  "10": 0,
};

export interface KickoffOptions {
  kickType?: KickType;
  returnType?: ReturnType;
}

export function resolveKickoff(
  state: GameState,
  rng: Rng,
  opts: KickoffOptions = {},
): SpecialResolution {
  const kicker = state.field.offense;
  const receiver = opp(kicker);

  // Safety-kick path: v5.1 carve-out treats it like a punt from the 35.
  // No picks are prompted for, so `kickType` will be undefined here.
  if (state.isSafetyKick || !opts.kickType) {
    const kickingState: GameState = {
      ...state,
      field: { ...state.field, ballOn: 35 },
    };
    const result = resolvePunt(kickingState, rng, { safetyKick: true });
    // F-54: a return TD on the safety kick means resolvePunt set phase to
    // PAT_CHOICE via applyTouchdown. Preserve scoring phases; only fall
    // through to REG_PLAY when the kick produced a normal new possession.
    const preserve = result.state.phase === "PAT_CHOICE" ||
      result.state.phase === "TWO_PT_CONV";
    const phase = preserve ? result.state.phase : "REG_PLAY";
    return {
      state: { ...result.state, phase, isSafetyKick: false },
      events: result.events,
    };
  }

  const { kickType, returnType } = opts;
  const events: Event[] = [];
  events.push({ type: "KICK_TYPE_CHOSEN", player: kicker, choice: kickType });
  if (returnType) {
    events.push({
      type: "RETURN_TYPE_CHOSEN",
      player: receiver,
      choice: returnType,
    });
  }

  if (kickType === "RK") {
    return resolveRegularKick(state, rng, events, kicker, receiver, returnType);
  }
  if (kickType === "OK") {
    return resolveOnsideKick(state, rng, events, kicker, receiver, returnType);
  }
  return resolveSquibKick(state, rng, events, kicker, receiver, returnType);
}

function resolveRegularKick(
  state: GameState,
  rng: Rng,
  events: Event[],
  kicker: GameState["field"]["offense"],
  receiver: GameState["field"]["offense"],
  returnType: ReturnType | undefined,
): SpecialResolution {
  // Returner chose touchback (or mismatched OR): ball at the receiver's 25.
  if (returnType === "TB" || returnType === "OR") {
    events.push({ type: "TOUCHBACK", receivingPlayer: receiver });
    return {
      state: {
        ...state,
        phase: "REG_PLAY",
        isSafetyKick: false,
        pendingPick: blankPick(),
        field: {
          ballOn: 25,
          firstDownAt: 35,
          down: 1,
          offense: receiver,
        },
      },
      events,
    };
  }

  // RK + RR: kick distance 35..60, then mult+yards return.
  const kickRoll = rng.d6();
  const kickYards = 35 + 5 * (kickRoll - 1); // 35, 40, 45, 50, 55, 60 — 35..60
  const kickEndFromKicker = 35 + kickYards; // 70..95, bounded to 100
  const boundedEnd = Math.min(100, kickEndFromKicker);
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: boundedEnd, kickRoll, kickYards });

  // Receiver's starting ballOn (possession flipped).
  const receiverStart = 100 - boundedEnd; // 0..30

  let deck = state.deck;
  const multDraw = drawMultiplier(deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  deck = multDraw.deck;

  const yardsDraw = drawYards(deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  deck = yardsDraw.deck;

  const mult = KICKOFF_MULTIPLIERS[multDraw.card];
  const retYards = mult * yardsDraw.card;
  if (retYards !== 0) {
    events.push({ type: "KICKOFF_RETURN", returnerPlayer: receiver, yards: retYards });
  }

  const finalBallOn = receiverStart + retYards;

  if (finalBallOn >= 100) {
    return applyTouchdown(
      { ...state, deck, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events,
    );
  }
  if (finalBallOn <= 0) {
    // Return backward into own end zone — unlikely with v5.1 multipliers but model it.
    return applySafety(
      { ...state, deck, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events,
    );
  }

  return {
    state: {
      ...state,
      deck,
      phase: "REG_PLAY",
      isSafetyKick: false,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: receiver,
      },
    },
    events,
  };
}

function resolveOnsideKick(
  state: GameState,
  rng: Rng,
  events: Event[],
  kicker: GameState["field"]["offense"],
  receiver: GameState["field"]["offense"],
  returnType: ReturnType | undefined,
): SpecialResolution {
  // Returner's OR choice correctly reads the onside — makes recovery harder.
  const odds = returnType === "OR" ? 12 : 6;
  const tmp = rng.intBetween(1, odds);
  const recovered = tmp === 1;
  const kickYards = 10 + tmp; // short kick 11..16 (or 11..22 vs OR)
  const kickEnd = 35 + kickYards;

  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: kickEnd, kickRoll: tmp, kickYards });
  events.push({
    type: "ONSIDE_KICK",
    recovered,
    recoveringPlayer: recovered ? kicker : receiver,
    roll: tmp,
    odds,
  });

  const returnRoll = rng.d6() + tmp; // v5.1: tmp + d6

  if (recovered) {
    // Kicker retains. v5.1 flips return direction — models "kicker recovers
    // slightly back of the kick spot."
    const kickerBallOn = Math.max(1, kickEnd - returnRoll);
    return {
      state: {
        ...state,
        phase: "REG_PLAY",
        isSafetyKick: false,
        pendingPick: blankPick(),
        field: {
          ballOn: kickerBallOn,
          firstDownAt: Math.min(100, kickerBallOn + 10),
          down: 1,
          offense: kicker,
        },
      },
      events,
    };
  }

  // Receiver recovers at the kick spot, returns forward.
  const receiverStart = 100 - kickEnd;
  const finalBallOn = receiverStart + returnRoll;
  if (returnRoll !== 0) {
    events.push({ type: "KICKOFF_RETURN", returnerPlayer: receiver, yards: returnRoll });
  }

  if (finalBallOn >= 100) {
    return applyTouchdown(
      { ...state, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events,
    );
  }

  return {
    state: {
      ...state,
      phase: "REG_PLAY",
      isSafetyKick: false,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: receiver,
      },
    },
    events,
  };
}

function resolveSquibKick(
  state: GameState,
  rng: Rng,
  events: Event[],
  kicker: GameState["field"]["offense"],
  receiver: GameState["field"]["offense"],
  returnType: ReturnType | undefined,
): SpecialResolution {
  const kickRoll = rng.d6();
  const kickYards = 15 + 5 * kickRoll; // 20..45
  const kickEnd = Math.min(100, 35 + kickYards);
  events.push({ type: "KICKOFF", receivingPlayer: receiver, ballOn: kickEnd, kickRoll, kickYards });

  // Only returnable if receiver chose RR; otherwise no return.
  const retYards = returnType === "RR" ? rng.d6() + rng.d6() : 0;
  if (retYards > 0) {
    events.push({ type: "KICKOFF_RETURN", returnerPlayer: receiver, yards: retYards });
  }

  const receiverStart = 100 - kickEnd;
  const finalBallOn = receiverStart + retYards;

  if (finalBallOn >= 100) {
    return applyTouchdown(
      { ...state, field: { ...state.field, offense: receiver }, isSafetyKick: false },
      receiver,
      events,
    );
  }

  return {
    state: {
      ...state,
      phase: "REG_PLAY",
      isSafetyKick: false,
      pendingPick: blankPick(),
      field: {
        ballOn: finalBallOn,
        firstDownAt: Math.min(100, finalBallOn + 10),
        down: 1,
        offense: receiver,
      },
    },
    events,
  };
}
