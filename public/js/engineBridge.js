/**
 * Bridge between v5.1's imperative Game/Player/Run state and the engine's
 * GameState. Used by the run.js resolvers during Phase 2 to let each
 * special-play mechanic go through the engine while v5.1 still owns the
 * overall flow.
 *
 * When Phase 2 finishes and playMechanism collapses into engine.reduce,
 * these helpers become unnecessary and the file can be deleted.
 */

import { emptyStats, freshDeckMultipliers, freshDeckYards } from './engine.js'

const PHASE_FROM_STATUS = new Map([
  [-4, 'KICKOFF'], // SAFETY_KICK
  [-3, 'KICKOFF'],
  [-1, 'KICKOFF'], // KICK
  [0, 'INIT'],
  [1, 'INIT'], // INIT_OTC
  [2, 'OT_START'],
  [11, 'REG_PLAY'], // REG
  [12, 'REG_PLAY'], // OFF_TP
  [13, 'REG_PLAY'], // DEF_TP
  [14, 'REG_PLAY'], // SAME
  [15, 'REG_PLAY'], // FG
  [16, 'REG_PLAY'], // PUNT
  [17, 'REG_PLAY'], // HAIL
  [20, 'TWO_PT_CONV'],
  [101, 'PAT_CHOICE'], // TD
  [102, 'KICKOFF'] // SAFETY
])

export function buildEngineState (game) {
  const offense = game.offNum
  const down = Math.max(1, Math.min(4, game.down || 1))

  return {
    phase: PHASE_FROM_STATUS.get(game.status) ?? 'REG_PLAY',
    schemaVersion: 1,
    clock: {
      quarter: game.qtr,
      secondsRemaining: Math.round(game.currentTime * 60),
      quarterLengthMinutes: game.qtrLength
    },
    field: {
      // v5.1's game.spot and the engine's ballOn both measure distance from
      // the OFFENSE's own goal (0 = own goal, 100 = opponent goal). No flip.
      ballOn: game.spot ?? 0,
      firstDownAt: game.firstDown ?? (game.spot + 10),
      down,
      offense
    },
    deck: {
      multipliers: game.mults ? [...game.mults] : freshDeckMultipliers(),
      yards: game.yards ? [...game.yards] : freshDeckYards()
    },
    players: {
      1: buildPlayerState(game.players[1]),
      2: buildPlayerState(game.players[2])
    },
    openingReceiver: game.recFirst ?? null,
    overtime: game.qtr > 4
      ? {
          period: game.qtr - 4,
          possession: offense,
          firstReceiver: game.recFirst ?? offense,
          possessionsRemaining: Math.abs(game.otPoss || 2)
        }
      : null,
    pendingPick: { offensePlay: null, defensePlay: null },
    lastPlayDescription: game.lastPlay ?? ''
  }
}

function buildPlayerState (player) {
  const hand = handFromPlays(player?.plays, player?.hm ?? 3)
  return {
    team: { id: player?.team?.abrv ?? player?.team?.name ?? '?' },
    score: player?.score ?? 0,
    timeouts: player?.timeouts ?? 3,
    hand,
    stats: emptyStats()
  }
}

function handFromPlays (plays, hm) {
  if (!plays) return { SR: 3, LR: 3, SP: 3, LP: 3, TP: 1, HM: hm }
  return {
    SR: plays.SR?.count ?? 0,
    LR: plays.LR?.count ?? 0,
    SP: plays.SP?.count ?? 0,
    LP: plays.LP?.count ?? 0,
    TP: plays.TP?.count ?? 0,
    HM: hm
  }
}

/**
 * Apply an engine GameState back to a v5.1 Game, mutating only the
 * fields the engine owns this round. Leaves UI-specific v5.1 fields
 * (thisPlay, connection, lastPlay) alone.
 */
export function applyEngineStateToGame (game, engineState) {
  game.spot = engineState.field.ballOn
  game.firstDown = engineState.field.firstDownAt
  game.down = engineState.field.down
  game.offNum = engineState.field.offense
  game.defNum = engineState.field.offense === 1 ? 2 : 1
  game.mults = [...engineState.deck.multipliers]
  game.yards = [...engineState.deck.yards]
  game.players[1].score = engineState.players[1].score
  game.players[2].score = engineState.players[2].score
  game.players[1].timeouts = engineState.players[1].timeouts
  game.players[2].timeouts = engineState.players[2].timeouts
  game.players[1].hm = engineState.players[1].hand.HM
  game.players[2].hm = engineState.players[2].hand.HM
  // Phase → status mapping is done at the resolver call site since v5.1
  // status carries more granularity than engine phase.
}

/**
 * Build a replay-Rng for use with engine resolvers when v5.1 has
 * already awaited the async Utils.randInt / rollDie / coinFlip. The
 * caller supplies the values in the order the engine will ask for them.
 */
export function replayRng (values) {
  const seq = [...values]
  return {
    intBetween: () => (typeof seq[0] === 'number' ? seq.shift() : 0),
    coinFlip: () => (seq[0] === 'heads' || seq[0] === 'tails' ? seq.shift() : 'heads'),
    d6: () => {
      const v = seq[0]
      if (typeof v === 'number' && v >= 1 && v <= 6) return seq.shift()
      return 1
    }
  }
}
