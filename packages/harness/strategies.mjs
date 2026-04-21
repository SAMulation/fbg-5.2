/**
 * Play-picking strategies for the headless bots. Each strategy is a
 * plain object with methods the client calls at each decision point.
 *
 * All strategies assume they see the full engine state (fairness is
 * off the table — this is for testing the engine + protocol, not
 * balancing gameplay).
 */

const REG_PLAYS = ['SR', 'LR', 'SP', 'LP']

function pickRandom (arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function myHand (state, me) {
  return state.players[me].hand
}

function availableOffenseCalls (state, me) {
  const hand = myHand(state, me)
  const calls = []
  for (const p of REG_PLAYS) if (hand[p] > 0) calls.push(p)
  if (hand.TP > 0) calls.push('TP')
  if (hand.HM > 0) calls.push('HM')
  // 4th down options.
  if (state.field.down === 4) {
    calls.push('FG')
    calls.push('PUNT')
  }
  return calls.length ? calls : ['SR']
}

function availableDefenseCalls (state, me) {
  const hand = myHand(state, me)
  const calls = []
  for (const p of REG_PLAYS) if (hand[p] > 0) calls.push(p)
  if (hand.TP > 0) calls.push('TP')
  return calls.length ? calls : ['SR']
}

/**
 * Fully random. Picks uniformly from legal plays in-hand.
 */
export const randomStrategy = {
  name: 'random',
  coinCall: () => (Math.random() < 0.5 ? 'heads' : 'tails'),
  receiveOrDefer: () => (Math.random() < 0.5 ? 'receive' : 'defer'),
  patChoice: () => (Math.random() < 0.25 ? 'two_point' : 'kick'),
  pickPlay (state, me) {
    const amOffense = state.field.offense === me
    const pool = amOffense ? availableOffenseCalls(state, me) : availableDefenseCalls(state, me)
    return pickRandom(pool)
  }
}

/**
 * Aggressive: prefers long plays and Hail Marys on 4th & long.
 */
export const aggressiveStrategy = {
  name: 'aggressive',
  coinCall: () => 'heads',
  receiveOrDefer: () => 'receive',
  patChoice: (state) => {
    // Always go for 2 if trailing by > 3.
    const me = state.field.offense
    const other = me === 1 ? 2 : 1
    const trailing = state.players[me].score < state.players[other].score
    return trailing ? 'two_point' : 'kick'
  },
  pickPlay (state, me) {
    const amOffense = state.field.offense === me
    const hand = myHand(state, me)
    if (amOffense) {
      // 4th & long: FG if close, else go for it with LP.
      if (state.field.down === 4) {
        const yardsToFirst = state.field.firstDownAt - state.field.ballOn
        if (yardsToFirst > 4 && state.field.ballOn > 65 && hand.LP > 0) return 'LP'
        if (state.field.ballOn >= 60) return 'FG'
        return 'PUNT'
      }
      // Low time + near own goal: HM
      if (state.clock.secondsRemaining < 120 && hand.HM > 0) return 'HM'
      const prefs = ['LP', 'LR', 'SP', 'SR']
      for (const p of prefs) if (hand[p] > 0) return p
    } else {
      // Defense: match offense's last known pendingPick if any, else LR.
      const off = state.pendingPick.offensePlay
      if (off && hand[off] > 0) return off
      const prefs = ['LR', 'LP', 'SR', 'SP']
      for (const p of prefs) if (hand[p] > 0) return p
    }
    return 'SR'
  }
}

/**
 * Conservative: short runs, take the FG, punt on 4th.
 */
export const conservativeStrategy = {
  name: 'conservative',
  coinCall: () => 'tails',
  receiveOrDefer: () => 'defer',
  patChoice: () => 'kick',
  pickPlay (state, me) {
    const amOffense = state.field.offense === me
    const hand = myHand(state, me)
    if (amOffense) {
      if (state.field.down === 4) {
        if (state.field.ballOn >= 55) return 'FG'
        return 'PUNT'
      }
      const prefs = ['SR', 'SP', 'LR', 'LP']
      for (const p of prefs) if (hand[p] > 0) return p
    } else {
      const prefs = ['SR', 'SP', 'LR', 'LP']
      for (const p of prefs) if (hand[p] > 0) return p
    }
    return 'SR'
  }
}

export const ALL_STRATEGIES = {
  random: randomStrategy,
  aggressive: aggressiveStrategy,
  conservative: conservativeStrategy
}
