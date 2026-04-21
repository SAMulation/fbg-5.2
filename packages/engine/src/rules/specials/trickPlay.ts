/**
 * Trick Play resolution (run.js:1987). One per shuffle, called by either
 * offense or defense. Die roll:
 *
 *   1 → Long Pass with +5 bonus   (matchup uses LP vs defense's pick)
 *   2 → 15-yard penalty on opposing side (half-to-goal if tight)
 *   3 → fixed -3x multiplier, draw yards card
 *   4 → fixed +4x multiplier, draw yards card
 *   5 → Big Play (beneficiary = caller)
 *   6 → Long Run with +5 bonus    (matchup uses LR vs defense's pick)
 *
 * When defense calls Trick Play, the sign of the yardage outcome flips
 * (negative for offense). For brevity this first port handles offensive
 * Trick Play only — defensive Trick Play is left as a todo since the
 * interactions with matchup orientation need dedicated tests.
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState, PlayerId, RegularPlay } from "../../types.js";
import { drawMultiplier, drawYards } from "../deck.js";
import { MULTI, matchupQuality } from "../matchup.js";
import { resolveBigPlay } from "./bigPlay.js";
import {
  applyYardageOutcome,
  blankPick,
  type SpecialResolution,
} from "./shared.js";

export function resolveOffensiveTrickPlay(
  state: GameState,
  rng: Rng,
): SpecialResolution {
  const offense = state.field.offense;
  const die = rng.d6();
  const events: Event[] = [{ type: "TRICK_PLAY_ROLL", outcome: die }];

  // 5 → Big Play for offense (caller).
  if (die === 5) {
    const bp = resolveBigPlay(state, offense, rng);
    return { state: bp.state, events: [...events, ...bp.events] };
  }

  // 2 → 15-yard penalty on defense (= offense gains 15 or half-to-goal).
  if (die === 2) {
    const rawGain = 15;
    const gain =
      state.field.ballOn + rawGain > 99
        ? Math.trunc((100 - state.field.ballOn) / 2)
        : rawGain;
    events.push({ type: "PENALTY", against: opponent(offense), yards: gain, lossOfDown: false });
    return {
      state: {
        ...state,
        pendingPick: blankPick(),
        field: {
          ...state.field,
          ballOn: Math.min(100, state.field.ballOn + gain),
        },
      },
      events,
    };
  }

  // 3 or 4 → fixed multiplier, draw yards card.
  if (die === 3 || die === 4) {
    const multiplier = die === 3 ? -3 : 4;
    const yardsDraw = drawYards(state.deck, rng);
    if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
    const yards = Math.round(multiplier * yardsDraw.card);

    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: "TP",
      defensePlay: state.pendingPick.defensePlay ?? "SR",
      matchupQuality: 0,
      multiplier: { card: "King", value: multiplier },
      yardsCard: yardsDraw.card,
      yardsGained: yards,
      newBallOn: Math.max(0, Math.min(100, state.field.ballOn + yards)),
    });

    return applyYardageOutcome(
      { ...state, deck: yardsDraw.deck },
      yards,
      events,
    );
  }

  // 1 or 6 → regular play resolution with forced offense play + bonus.
  const forcedPlay: RegularPlay = die === 1 ? "LP" : "LR";
  const bonus = 5;
  const defensePlay = state.pendingPick.defensePlay ?? "SR";

  // Must be a regular play for matchup to be meaningful. If defense also picked
  // something weird, fall back to quality 3 (neutral).
  const defPlay = isRegular(defensePlay) ? defensePlay : "SR";
  const quality = matchupQuality(forcedPlay, defPlay);

  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });

  const multRow = MULTI[multDraw.index];
  const multiplier = multRow?.[quality - 1] ?? 0;
  const yards = Math.round(multiplier * yardsDraw.card) + bonus;

  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: forcedPlay,
    defensePlay: defPlay,
    matchupQuality: quality,
    multiplier: { card: multDraw.card, value: multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: yards,
    newBallOn: Math.max(0, Math.min(100, state.field.ballOn + yards)),
  });

  return applyYardageOutcome(
    { ...state, deck: yardsDraw.deck },
    yards,
    events,
  );
}

function isRegular(p: string): p is RegularPlay {
  return p === "SR" || p === "LR" || p === "SP" || p === "LP";
}

function opponent(p: PlayerId): PlayerId {
  return p === 1 ? 2 : 1;
}
