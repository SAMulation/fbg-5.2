/**
 * Regular-play resolution. Special plays (TP, HM, FG, PUNT, TWO_PT) branch
 * elsewhere — see rules/special.ts (TODO).
 *
 * Given two picks (offense + defense) and the current state, produce a new
 * state and the event stream for the play.
 */

import type { Event } from "../events.js";
import type { Rng } from "../rng.js";
import type { GameState, PlayCall, RegularPlay } from "../types.js";
import { drawMultiplier, drawYards } from "./deck.js";
import { computeYardage } from "./yardage.js";
import { opp } from "../state.js";

const REGULAR: ReadonlySet<PlayCall> = new Set(["SR", "LR", "SP", "LP"]);

export function isRegularPlay(p: PlayCall): p is RegularPlay {
  return REGULAR.has(p);
}

export interface ResolveInput {
  offensePlay: PlayCall;
  defensePlay: PlayCall;
}

export interface PlayResolution {
  state: GameState;
  events: Event[];
}

/**
 * Resolve a regular vs regular play. Caller (the reducer) routes to special
 * play handlers if either pick is non-regular.
 */
export function resolveRegularPlay(
  state: GameState,
  input: ResolveInput,
  rng: Rng,
): PlayResolution {
  if (!isRegularPlay(input.offensePlay) || !isRegularPlay(input.defensePlay)) {
    throw new Error("resolveRegularPlay called with a non-regular play");
  }

  const events: Event[] = [];

  // Draw cards.
  const multDraw = drawMultiplier(state.deck, rng);
  if (multDraw.reshuffled) {
    events.push({ type: "DECK_SHUFFLED", deck: "multiplier" });
  }
  const yardsDraw = drawYards(multDraw.deck, rng);
  if (yardsDraw.reshuffled) {
    events.push({ type: "DECK_SHUFFLED", deck: "yards" });
  }

  // Compute yardage.
  const outcome = computeYardage({
    offense: input.offensePlay,
    defense: input.defensePlay,
    multiplierCard: multDraw.index,
    yardsCard: yardsDraw.card,
  });

  // Decrement offense's hand for the play they used. Refill at zero — the
  // exact 12-card reshuffle behavior lives in `decrementHand`.
  const offense = state.field.offense;
  const newPlayers = {
    ...state.players,
    [offense]: decrementHand(state.players[offense], input.offensePlay),
  } as GameState["players"];

  // Apply yardage to ball position. Clamp at 100 (TD) and 0 (safety).
  const projected = state.field.ballOn + outcome.yardsGained;
  let newBallOn = projected;
  let scored: "td" | "safety" | null = null;
  if (projected >= 100) {
    newBallOn = 100;
    scored = "td";
  } else if (projected <= 0) {
    newBallOn = 0;
    scored = "safety";
  }

  events.push({
    type: "PLAY_RESOLVED",
    offensePlay: input.offensePlay,
    defensePlay: input.defensePlay,
    matchupQuality: outcome.matchupQuality,
    multiplier: { card: outcome.multiplierCardName, value: outcome.multiplier },
    yardsCard: yardsDraw.card,
    yardsGained: outcome.yardsGained,
    newBallOn,
  });

  // Score handling.
  if (scored === "td") {
    return touchdownState(
      { ...state, deck: yardsDraw.deck, players: newPlayers, pendingPick: blankPick() },
      offense,
      events,
    );
  }
  if (scored === "safety") {
    return safetyState(
      { ...state, deck: yardsDraw.deck, players: newPlayers, pendingPick: blankPick() },
      offense,
      events,
    );
  }

  // Down/distance handling.
  const reachedFirstDown = newBallOn >= state.field.firstDownAt;
  let nextDown = state.field.down;
  let nextFirstDownAt = state.field.firstDownAt;
  let possessionFlipped = false;

  if (reachedFirstDown) {
    nextDown = 1;
    nextFirstDownAt = Math.min(100, newBallOn + 10);
    events.push({ type: "FIRST_DOWN" });
  } else if (state.field.down === 4) {
    // Turnover on downs — possession flips, ball stays.
    nextDown = 1;
    possessionFlipped = true;
    events.push({ type: "TURNOVER_ON_DOWNS" });
    events.push({ type: "TURNOVER", reason: "downs" });
  } else {
    nextDown = (state.field.down + 1) as 1 | 2 | 3 | 4;
  }

  const nextOffense = possessionFlipped ? opp(offense) : offense;
  const nextBallOn = possessionFlipped ? 100 - newBallOn : newBallOn;
  const nextFirstDown = possessionFlipped
    ? Math.min(100, nextBallOn + 10)
    : nextFirstDownAt;

  return {
    state: {
      ...state,
      deck: yardsDraw.deck,
      players: newPlayers,
      pendingPick: blankPick(),
      field: {
        ballOn: nextBallOn,
        firstDownAt: nextFirstDown,
        down: nextDown,
        offense: nextOffense,
      },
    },
    events,
  };
}

function blankPick(): GameState["pendingPick"] {
  return { offensePlay: null, defensePlay: null };
}

/**
 * Touchdown bookkeeping — 6 points, transition to PAT_CHOICE phase.
 * (PAT/2pt resolution and ensuing kickoff happen in subsequent actions.)
 */
function touchdownState(
  state: GameState,
  scorer: GameState["field"]["offense"],
  events: Event[],
): PlayResolution {
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 6 },
  } as GameState["players"];
  events.push({ type: "TOUCHDOWN", scoringPlayer: scorer });
  return {
    state: { ...state, players: newPlayers, phase: "PAT_CHOICE" },
    events,
  };
}

/**
 * Safety — defense scores 2, offense kicks free kick.
 * For the sketch we score and emit; the kickoff transition is TODO.
 */
function safetyState(
  state: GameState,
  conceder: GameState["field"]["offense"],
  events: Event[],
): PlayResolution {
  const scorer = opp(conceder);
  const newPlayers = {
    ...state.players,
    [scorer]: { ...state.players[scorer], score: state.players[scorer].score + 2 },
  } as GameState["players"];
  events.push({ type: "SAFETY", scoringPlayer: scorer });
  return {
    state: { ...state, players: newPlayers, phase: "KICKOFF" },
    events,
  };
}

/**
 * Decrement the chosen play in a player's hand. If the regular-play cards
 * (SR/LR/SP/LP) are all exhausted, refill them — Hail Mary count is
 * preserved across refills (matches v5.1 Player.fillPlays('p')).
 */
function decrementHand(
  player: GameState["players"][1],
  play: PlayCall,
): GameState["players"][1] {
  const hand = { ...player.hand };

  if (play === "HM") {
    hand.HM = Math.max(0, hand.HM - 1);
    return { ...player, hand };
  }

  if (play === "FG" || play === "PUNT" || play === "TWO_PT") {
    // No card consumed — these are situational decisions, not draws.
    return player;
  }

  hand[play] = Math.max(0, hand[play] - 1);

  const regularExhausted =
    hand.SR === 0 && hand.LR === 0 && hand.SP === 0 && hand.LP === 0 && hand.TP === 0;

  if (regularExhausted) {
    return {
      ...player,
      hand: { SR: 3, LR: 3, SP: 3, LP: 3, TP: 1, HM: hand.HM },
    };
  }

  return { ...player, hand };
}
