/**
 * Events are the engine's outputs. They describe *what happened* in atomic units
 * the client can render: animations, sound effects, banner messages.
 *
 * Server broadcasts the event stream to all connected clients. Clients apply
 * events sequentially to drive their UI.
 *
 * Events are derivable from `(prevState, action, newState)` — they exist
 * primarily for the renderer's benefit, since the client wants to *animate*
 * "ball moved 12 yards then 1st down" rather than just see the new state pop in.
 */

import type { PlayCall, PlayerId } from "./types.js";

export type Event =
  | { type: "GAME_STARTED" }
  | { type: "COIN_TOSS_RESULT"; result: "heads" | "tails"; winner: PlayerId }
  | { type: "KICKOFF"; receivingPlayer: PlayerId; ballOn: number }
  | { type: "PLAY_CALLED"; player: PlayerId; play: PlayCall }
  | {
      type: "PLAY_RESOLVED";
      offensePlay: PlayCall;
      defensePlay: PlayCall;
      matchupQuality: number;
      multiplier: { card: "King" | "Queen" | "Jack" | "10"; value: number };
      yardsCard: number;
      yardsGained: number;
      newBallOn: number;
    }
  | { type: "FIRST_DOWN" }
  | { type: "TURNOVER_ON_DOWNS" }
  | { type: "TURNOVER"; reason: "interception" | "fumble" | "downs" | "missed_fg" }
  | { type: "TOUCHDOWN"; scoringPlayer: PlayerId }
  | { type: "FIELD_GOAL_GOOD"; player: PlayerId }
  | { type: "FIELD_GOAL_MISSED"; player: PlayerId }
  | { type: "PAT_GOOD"; player: PlayerId }
  | { type: "TWO_POINT_GOOD"; player: PlayerId }
  | { type: "TWO_POINT_FAILED"; player: PlayerId }
  | { type: "SAFETY"; scoringPlayer: PlayerId }
  | { type: "PUNT"; player: PlayerId; landingSpot: number }
  | { type: "TIMEOUT_CALLED"; player: PlayerId; remaining: number }
  | { type: "TWO_MINUTE_WARNING" }
  | { type: "QUARTER_ENDED"; quarter: number }
  | { type: "HALF_ENDED" }
  | { type: "OVERTIME_STARTED"; period: number; possession: PlayerId }
  | { type: "TRICK_PLAY_ROLL"; outcome: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "HAIL_MARY_ROLL"; outcome: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "SAME_PLAY_COIN"; outcome: "heads" | "tails" }
  | { type: "BIG_PLAY"; beneficiary: PlayerId; subroll: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "PENALTY"; against: PlayerId; yards: number; lossOfDown: boolean }
  | { type: "CLOCK_TICKED"; seconds: number }
  | { type: "DECK_SHUFFLED"; deck: "play" | "multiplier" | "yards" | "hail_mary" }
  | { type: "GAME_OVER"; winner: PlayerId | null };
