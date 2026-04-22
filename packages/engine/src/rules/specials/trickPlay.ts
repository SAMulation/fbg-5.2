/**
 * Trick Play resolution (run.js:1987). One per shuffle, called by either
 * offense or defense. Die roll outcomes (from the *caller's* perspective):
 *
 *   1 → Long Pass with +5 bonus   (matchup uses LP vs the other side's pick)
 *   2 → 15-yard penalty on opposing side (half-to-goal if tight)
 *   3 → fixed -3x multiplier, draw yards card
 *   4 → fixed +4x multiplier, draw yards card
 *   5 → Big Play (beneficiary = caller)
 *   6 → Long Run with +5 bonus
 *
 * When the caller is the defense, the yardage signs invert (defense gains =
 * offense loses), the LR/LP overlay is applied to the defensive call, and
 * the Big Play beneficiary is defense.
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
    const newBallOn = Math.min(100, state.field.ballOn + gain);
    events.push({ type: "PENALTY", against: opponent(offense), yards: gain, lossOfDown: false });
    // R-25: if the penalty GAIN carries the ball to or past the
    // first-down marker, grant automatic first down — reset down to 1
    // and firstDownAt to ballOn + 10. Otherwise keep the current down
    // (same-down replays with yards-to-go updated).
    const reachedFirstDown = newBallOn >= state.field.firstDownAt;
    const nextDown = reachedFirstDown ? 1 : state.field.down;
    const nextFirstDownAt = reachedFirstDown
      ? Math.min(100, newBallOn + 10)
      : state.field.firstDownAt;
    if (reachedFirstDown) events.push({ type: "FIRST_DOWN" });
    return {
      state: {
        ...state,
        pendingPick: blankPick(),
        field: {
          ...state.field,
          ballOn: newBallOn,
          down: nextDown,
          firstDownAt: nextFirstDownAt,
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

/**
 * Defense calls Trick Play. Symmetric to the offensive version with the
 * yardage sign inverted on the LR/LP and penalty branches.
 */
export function resolveDefensiveTrickPlay(
  state: GameState,
  rng: Rng,
): SpecialResolution {
  const offense = state.field.offense;
  const defender = opponent(offense);
  const die = rng.d6();
  const events: Event[] = [{ type: "TRICK_PLAY_ROLL", outcome: die }];

  // 5 → Big Play for defense (caller).
  if (die === 5) {
    const bp = resolveBigPlay(state, defender, rng);
    return { state: bp.state, events: [...events, ...bp.events] };
  }

  // 2 → 15-yard penalty on offense (= offense loses 15 or half-to-own-goal).
  if (die === 2) {
    const rawLoss = -15;
    const loss =
      state.field.ballOn + rawLoss < 1
        ? -Math.trunc(state.field.ballOn / 2)
        : rawLoss;
    events.push({ type: "PENALTY", against: offense, yards: loss, lossOfDown: false });
    return {
      state: {
        ...state,
        pendingPick: { offensePlay: null, defensePlay: null },
        field: {
          ...state.field,
          ballOn: Math.max(0, state.field.ballOn + loss),
        },
      },
      events,
    };
  }

  // 3 or 4 → fixed multiplier with the *defense's* sign convention. v5.1
  // applies the same +/- multipliers as offensive Trick Play; the inversion
  // is implicit in defense being the caller. Yardage is from offense POV.
  if (die === 3 || die === 4) {
    const multiplier = die === 3 ? -3 : 4;
    const yardsDraw = drawYards(state.deck, rng);
    if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });
    const yards = Math.round(multiplier * yardsDraw.card);

    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: state.pendingPick.offensePlay ?? "SR",
      defensePlay: "TP",
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

  // 1 or 6 → defense's pick becomes LP / LR with -5 bonus to offense.
  const forcedDefPlay: RegularPlay = die === 1 ? "LP" : "LR";
  const bonus = -5;
  const offensePlay = state.pendingPick.offensePlay ?? "SR";
  const offPlay = isRegular(offensePlay) ? offensePlay : "SR";
  const quality = matchupQuality(offPlay, forcedDefPlay);

  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });

  const multRow = MULTI[multDraw.index];
  const multiplier = multRow?.[quality - 1] ?? 0;
  const yards = Math.round(multiplier * yardsDraw.card) + bonus;

  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: offPlay,
    defensePlay: forcedDefPlay,
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
