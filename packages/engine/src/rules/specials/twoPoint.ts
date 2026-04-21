/**
 * Two-Point Conversion (TWO_PT phase).
 *
 * Ball is placed at offense's 97 (= 3-yard line). A single regular play is
 * resolved. If the resulting yardage crosses the goal line, TWO_POINT_GOOD.
 * Otherwise, TWO_POINT_FAILED. Either way, kickoff follows.
 *
 * Unlike a normal play, a 2pt does NOT change down/distance. It's a one-shot.
 */

import type { Event } from "../../events.js";
import type { Rng } from "../../rng.js";
import type { GameState, RegularPlay } from "../../types.js";
import { drawMultiplier, drawYards } from "../deck.js";
import { computeYardage } from "../yardage.js";
import { blankPick, type SpecialResolution } from "./shared.js";

export function resolveTwoPointConversion(
  state: GameState,
  offensePlay: RegularPlay,
  defensePlay: RegularPlay,
  rng: Rng,
): SpecialResolution {
  const offense = state.field.offense;
  const events: Event[] = [];

  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) events.push({ type: "DECK_SHUFFLED", deck: "yards" });

  const outcome = computeYardage({
    offense: offensePlay,
    defense: defensePlay,
    multiplierCard: multDraw.index,
    yardsCard: yardsDraw.card,
  });

  // 2pt starts at 97. Crossing the goal = good.
  const startBallOn = 97;
  const projected = startBallOn + outcome.yardsGained;
  const good = projected >= 100;

  events.push({
    type: "PLAY_RESOLVED",
    offensePlay,
    defensePlay,
    matchupQuality: outcome.matchupQuality,
    multiplier: { card: outcome.multiplierCardName, value: outcome.multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: outcome.yardsGained,
    newBallOn: Math.max(0, Math.min(100, projected)),
  });

  const newPlayers = good
    ? ({
        ...state.players,
        [offense]: { ...state.players[offense], score: state.players[offense].score + 2 },
      } as GameState["players"])
    : state.players;

  events.push({
    type: good ? "TWO_POINT_GOOD" : "TWO_POINT_FAILED",
    player: offense,
  });

  return {
    state: {
      ...state,
      deck: yardsDraw.deck,
      players: newPlayers,
      pendingPick: blankPick(),
      phase: "KICKOFF",
    },
    events,
  };
}
