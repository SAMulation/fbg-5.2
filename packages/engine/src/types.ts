/**
 * Core game state types. This is the entire FootBored game, frozen as data.
 *
 * Everything here is plain serializable data — no methods, no class instances.
 * The engine reduces over this; the server persists it; the client renders it.
 */

export type PlayerId = 1 | 2;

export type RegularPlay = "SR" | "LR" | "SP" | "LP";
export type SpecialPlay = "TP" | "HM" | "FG" | "PUNT" | "TWO_PT";
export type PlayCall = RegularPlay | SpecialPlay;

/** Kicker's kickoff selection: Regular, Onside, Squib. */
export type KickType = "RK" | "OK" | "SK";
/** Returner's kickoff selection: Regular Return, Onside counter, Touchback. */
export type ReturnType = "RR" | "OR" | "TB";

export type GamePhase =
  | "INIT"
  | "COIN_TOSS"
  | "KICKOFF"
  | "REG_PLAY"
  | "TWO_MIN_WARNING"
  | "TWO_PT_CONV"
  | "PAT_CHOICE"
  | "OT_START"
  | "OT_PLAY"
  | "GAME_OVER";

export interface Hand {
  /** Counts of regular play cards remaining in the current 12-card cycle. */
  SR: number;
  LR: number;
  SP: number;
  LP: number;
  TP: number;
  /** Hail Marys remaining in current half (3 reg, 2 OT). */
  HM: number;
}

export interface Stats {
  /** Placeholder — will hold per-game stats once we port stat.js. */
  passYards: number;
  rushYards: number;
  turnovers: number;
  sacks: number;
}

export interface PlayerState {
  team: TeamRef;
  score: number;
  timeouts: number;
  hand: Hand;
  stats: Stats;
}

export interface TeamRef {
  /** Stable team identifier (e.g. "NE", "GB"). Engine doesn't know team metadata. */
  id: string;
}

export interface ClockState {
  /** Quarter: 1-4 regulation, 5+ overtime. */
  quarter: number;
  /** Seconds remaining in current quarter. */
  secondsRemaining: number;
  /** Quarter length in minutes (configurable per game). */
  quarterLengthMinutes: number;
}

export interface FieldState {
  /** Yard line of the ball, 0-100 (offense's own goal = 0, opponent goal = 100). */
  ballOn: number;
  /** Yards needed for first down, measured from ballOn. */
  firstDownAt: number;
  down: 1 | 2 | 3 | 4;
  /** Player ID currently on offense. */
  offense: PlayerId;
}

export interface DeckState {
  /** Multiplier deck card counts: [King, Queen, Jack, 10] */
  multipliers: [number, number, number, number];
  /** Yard deck card counts: index i = card value (i+1), so length 10 for cards 1-10 */
  yards: number[];
}

export interface OvertimeState {
  /** Period number (1, 2, 3, ...). 0 if not in OT. */
  period: number;
  /** Player who has possession this period. */
  possession: PlayerId;
  /** Player who received first in OT (so we can alternate). */
  firstReceiver: PlayerId;
  /** Possessions remaining in this period (2 = both pending, 1 = one done, 0 = period over). */
  possessionsRemaining: 0 | 1 | 2;
}

export interface PendingPick {
  offensePlay: PlayCall | null;
  defensePlay: PlayCall | null;
}

export interface GameState {
  phase: GamePhase;
  clock: ClockState;
  field: FieldState;
  deck: DeckState;
  players: { 1: PlayerState; 2: PlayerState };
  /** Player who received the opening kickoff. */
  openingReceiver: PlayerId | null;
  overtime: OvertimeState | null;
  pendingPick: PendingPick;
  /**
   * Append-only log of recent significant events for the recap pane.
   * Engine produces, consumer trims as needed.
   */
  lastPlayDescription: string;
  /**
   * True when the current pending kickoff (phase=KICKOFF) is a free kick
   * after a safety. Safety kicks skip the kick-type / return-type picks
   * and resolve via the simplified punt path. Cleared when kickoff resolves.
   */
  isSafetyKick: boolean;
  /** Schema version — bump when GameState shape changes. */
  schemaVersion: 1;
}
