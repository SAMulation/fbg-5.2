/**
 * Same Play mechanism (run.js:1899).
 *
 * Triggered when both teams pick the same regular play AND a coin-flip lands
 * heads (also unconditionally when both pick Trick Play). Runs its own
 * coin + multiplier-card chain:
 *
 *   multCard = King  → Big Play (offense if coin=heads, defense if tails)
 *   multCard = Queen + heads → multiplier = +3, draw yards card
 *   multCard = Queen + tails → multiplier =  0, no yards (dist = 0)
 *   multCard = Jack  + heads → multiplier =  0, no yards (dist = 0)
 *   multCard = Jack  + tails → multiplier = -3, draw yards card
 *   multCard = 10    + heads → INTERCEPTION (turnover at spot)
 *   multCard = 10    + tails → 0 yards
 *
 * Note: the coin flip inside this function is a SECOND coin flip — the
 * mechanism-trigger coin flip is handled by the reducer before calling here.
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState } from "../../types.js";
import { opp } from "../../state.js";
import { drawMultiplier, drawYards } from "../deck.js";
import { resolveBigPlay } from "./bigPlay.js";
import {
  applyYardageOutcome,
  blankPick,
  bumpStats,
  type SpecialResolution,
} from "./shared.js";

export function resolveSamePlay(state: GameState, rng: Rng): SpecialResolution {
  const offense = state.field.offense;
  const events: Event[] = [];

  const coin = rng.coinFlip();
  events.push({ type: "SAME_PLAY_COIN", outcome: coin });

  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });

  const stateAfterMult: GameState = { ...state, deck: multDraw.deck };
  const heads = coin === "heads";

  // King → Big Play for whichever side wins the coin.
  if (multDraw.card === "King") {
    const beneficiary = heads ? offense : opp(offense);
    const bp = resolveBigPlay(stateAfterMult, beneficiary, rng);
    return { state: bp.state, events: [...events, ...bp.events] };
  }

  // 10 → interception (heads) or 0 yards (tails).
  if (multDraw.card === "10") {
    if (heads) {
      events.push({ type: "TURNOVER", reason: "interception" });
      return {
        state: {
          ...stateAfterMult,
          players: bumpStats(stateAfterMult.players, offense, { turnovers: 1 }),
          pendingPick: blankPick(),
          field: {
            ...stateAfterMult.field,
            offense: opp(offense),
            ballOn: 100 - stateAfterMult.field.ballOn,
            firstDownAt: Math.min(100, 100 - stateAfterMult.field.ballOn + 10),
            down: 1,
          },
        },
        events,
      };
    }
    // 0 yards, down consumed. Emit PLAY_RESOLVED so the narrator can
    // render "no gain" instead of leaving only SAME_PLAY_COIN visible
    // and the down silently advancing (F-48).
    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: state.pendingPick.offensePlay ?? "SR",
      defensePlay: state.pendingPick.defensePlay ?? "SR",
      matchupQuality: 0,
      multiplier: { card: "10", value: 0 },
      yardsCard: 0,
      yardsGained: 0,
      newBallOn: stateAfterMult.field.ballOn,
    });
    return applyYardageOutcome(stateAfterMult, 0, events);
  }

  // Queen or Jack → multiplier, then draw yards card.
  let multiplier = 0;
  if (multDraw.card === "Queen") multiplier = heads ? 3 : 0;
  if (multDraw.card === "Jack") multiplier = heads ? 0 : -3;

  if (multiplier === 0) {
    // 0 yards, down consumed (F-48 — same as 10-tails branch above).
    events.push({
      type: "PLAY_RESOLVED",
      offensePlay: state.pendingPick.offensePlay ?? "SR",
      defensePlay: state.pendingPick.defensePlay ?? "SR",
      matchupQuality: 0,
      multiplier: { card: multDraw.card, value: 0 },
      yardsCard: 0,
      yardsGained: 0,
      newBallOn: stateAfterMult.field.ballOn,
    });
    return applyYardageOutcome(stateAfterMult, 0, events);
  }

  const yardsDraw = drawYards(stateAfterMult.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });

  const yards = Math.round(multiplier * yardsDraw.card);

  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: state.pendingPick.offensePlay ?? "SR",
    defensePlay: state.pendingPick.defensePlay ?? "SR",
    matchupQuality: 0,
    multiplier: { card: multDraw.card, value: multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: yards,
    newBallOn: Math.max(0, Math.min(100, stateAfterMult.field.ballOn + yards)),
  });

  return applyYardageOutcome(
    { ...stateAfterMult, deck: yardsDraw.deck },
    yards,
    events,
  );
}
