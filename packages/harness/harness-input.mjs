/**
 * HarnessInput — drop-in replacement for ButtonInput when running
 * GameDriver headlessly. `getInput` delegates to a strategy callback
 * rather than rendering buttons and waiting for a click.
 *
 * The strategy signature matches the existing @fbg/harness strategies
 * loosely but is local-game-shaped (no me/opponent roles, just "who's
 * deciding"):
 *   strategy.pick(game, p, type, msg) → string (e.g. 'SR', 'XP', 'H')
 */

export class HarnessInput {
  constructor (strategy) {
    this.type = 'harness'
    this.strategy = strategy
    this.legalChoices = []
  }

  async getInput (game, p, type, msg = null) {
    // For computer-controlled players, delegate to the real app CPU AI
    // (run.js cpuPlay + cpuPages). This exercises the same situational
    // logic the browser uses, so harness games reflect actual CPU behavior
    // — punts on 4th-and-long, FG attempts in range, end-of-half clock
    // management, kickoff picks per score/time situation, etc.
    if (game.isComputer && game.isComputer(p)) {
      return game.run.cpuPages(game, p, type, msg)
    }
    const choice = await this.strategy.pick(game, p, type, msg)
    if (choice === undefined || choice === null) {
      throw new Error(`strategy returned empty pick for p=${p} type=${type}`)
    }
    return choice
  }
}

/**
 * Picks a uniformly-random legal regular play; defaults for everything else.
 */
/**
 * Read the player's live hand from the authoritative engine state.
 * v5.1's game.players[p].plays counts are static and misleading — the
 * engine is the source of truth after every PLAY_RESOLVED.
 */
function handFor (game, p) {
  return game.engineState?.players?.[p]?.hand ?? {}
}

export const randomStrategy = {
  name: 'random',
  // Set >0 to occasionally pick TO during 'reg' picks — exercises the
  // timeout re-prompt loop in GameDriver.
  timeoutProbability: 0.05,
  pick (game, p, type) {
    if (type === 'reg') {
      // Occasional timeout call (if player has any left). Driver should
      // handle it by dispatching CALL_TIMEOUT + re-prompting.
      const toLeft = game.engineState?.players?.[p]?.timeouts ?? 0
      if (toLeft > 0 && Math.random() < this.timeoutProbability) return 'TO'

      const hand = handFor(game, p)
      const plays = ['SR', 'LR', 'SP', 'LP', 'TP']
      const legal = plays.filter((pl) => (hand[pl] ?? 0) > 0)
      const pool = legal.length ? legal : ['SR']
      return pool[Math.floor(Math.random() * pool.length)]
    }
    if (type === 'pat') return Math.random() < 0.2 ? '2P' : 'XP'
    if (type === 'coin') return Math.random() < 0.5 ? 'H' : 'T'
    if (type === 'kickDecReg') return Math.random() < 0.5 ? 'R' : 'K'
    if (type === 'kickDecOT') return Math.random() < 0.5 ? '1' : '2'
    if (type === 'kick') {
      const r = Math.random()
      if (r < 0.7) return 'RK'
      if (r < 0.85) return 'OK'
      return 'SK'
    }
    if (type === 'ret') {
      const r = Math.random()
      if (r < 0.7) return 'RR'
      if (r < 0.85) return 'OR'
      return 'TB'
    }
    return null
  }
}

/**
 * Always picks SR (boring but deterministic). Handy for reproducing
 * a specific scenario when paired with a seeded RNG.
 */
export const alwaysShortRunStrategy = {
  name: 'always_sr',
  pick (game, p, type) {
    if (type === 'reg') return 'SR'
    if (type === 'pat') return 'XP'
    if (type === 'coin') return 'H'
    if (type === 'kickDecReg') return 'R'
    if (type === 'kickDecOT') return '1'
    if (type === 'kick') return 'RK'
    if (type === 'ret') return 'RR'
    return null
  }
}
