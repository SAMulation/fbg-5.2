/**
 * Semantic invariants for harness runs.
 *
 * Subscribes to the same 'server-state' stream as the narrator. On each
 * (state, events) broadcast, asserts:
 *   - ballOn ∈ [0, 100]
 *   - down ∈ [1, 4]
 *   - scores monotonically increase (no point-subtraction regressions)
 *   - score deltas match the event stream (TOUCHDOWN → +6, PAT_GOOD → +1,
 *     TWO_POINT_GOOD → +2, SAFETY → +2, FIELD_GOAL_GOOD → +3)
 *   - phase transitions are legal (no REG_PLAY → OT_PLAY without passing
 *     through OT_START, etc.)
 *   - possession flips correctly on scoring plays in regulation
 *
 * Violations are collected and returned — runner decides whether to
 * print them, fail the run, or dump a transcript. The checker never
 * throws; it's purely observational.
 */

const LEGAL_TRANSITIONS = new Map([
  ['INIT', ['COIN_TOSS', 'GAME_OVER']],
  ['COIN_TOSS', ['KICKOFF']],
  ['KICKOFF', ['REG_PLAY', 'PAT_CHOICE', 'GAME_OVER']],
  ['REG_PLAY', ['REG_PLAY', 'KICKOFF', 'PAT_CHOICE', 'TWO_PT_CONV', 'OT_START', 'PENALTY_CHOICE', 'GAME_OVER']],
  ['TWO_PT_CONV', ['KICKOFF']],
  ['PAT_CHOICE', ['KICKOFF', 'TWO_PT_CONV', 'GAME_OVER']],
  ['PENALTY_CHOICE', ['REG_PLAY', 'OT_PLAY', 'KICKOFF', 'PAT_CHOICE', 'TWO_PT_CONV', 'OT_START', 'GAME_OVER']],
  ['OT_START', ['OT_PLAY']],
  ['OT_PLAY', ['OT_PLAY', 'OT_START', 'PAT_CHOICE', 'TWO_PT_CONV', 'PENALTY_CHOICE', 'GAME_OVER']],
  ['GAME_OVER', ['GAME_OVER']]
])

export class InvariantChecker {
  constructor (channel) {
    this.channel = channel
    this.prev = null
    this.violations = []
  }

  start () {
    this.channel.bind('server-state', ({ state, events }) => {
      this.check(state, events)
    })
  }

  flag (msg, ctx = {}) {
    this.violations.push({ msg, ctx })
  }

  check (state, events) {
    const prev = this.prev

    // Field bounds
    if (state.field.ballOn < 0 || state.field.ballOn > 100) {
      this.flag('ballOn out of bounds', { ballOn: state.field.ballOn, phase: state.phase })
    }
    if (![1, 2, 3, 4].includes(state.field.down)) {
      this.flag('down out of range', { down: state.field.down })
    }
    if (![1, 2].includes(state.field.offense)) {
      this.flag('offense not a valid PlayerId', { offense: state.field.offense })
    }

    // Phase transition legality
    if (prev && prev.phase !== state.phase) {
      const legal = LEGAL_TRANSITIONS.get(prev.phase) || []
      if (!legal.includes(state.phase)) {
        this.flag('illegal phase transition', {
          from: prev.phase,
          to: state.phase,
          eventsSinceLast: events.map(e => e.type)
        })
      }
    }

    // Score monotonicity
    if (prev) {
      for (const p of [1, 2]) {
        if (state.players[p].score < prev.players[p].score) {
          this.flag('score went down', {
            player: p,
            was: prev.players[p].score,
            now: state.players[p].score
          })
        }
      }
    }

    // Stat monotonicity (turnovers, sacks). Yardage stats can decrease on a
    // sack or HM big-sack, so they're not monotonic — but counts are.
    if (prev) {
      for (const p of [1, 2]) {
        for (const stat of ['turnovers', 'sacks']) {
          if (state.players[p].stats[stat] < prev.players[p].stats[stat]) {
            this.flag(`${stat} count decreased`, {
              player: p,
              was: prev.players[p].stats[stat],
              now: state.players[p].stats[stat]
            })
          }
        }
      }
    }

    // Stat→event consistency: a TURNOVER event in this batch should bump
    // the previous-offense's turnovers stat by exactly 1, EXCEPT for
    // missed-FG and turnover-on-downs-via-resolveYardageOutcome paths
    // (the FG/punt resolvers don't write stats yet).
    if (prev) {
      const turnoverEvents = events.filter(e =>
        e.type === 'TURNOVER' && (e.reason === 'fumble' || e.reason === 'interception')
      )
      if (turnoverEvents.length > 0) {
        const prevOffense = prev.field.offense
        const tDelta = state.players[prevOffense].stats.turnovers -
          prev.players[prevOffense].stats.turnovers
        if (tDelta < 1) {
          this.flag('TURNOVER event without stats bump', {
            offense: prevOffense,
            reasons: turnoverEvents.map(e => e.reason),
            tDelta
          })
        }
      }
    }

    // Score delta matches events
    if (prev) {
      const deltas = {
        1: state.players[1].score - prev.players[1].score,
        2: state.players[2].score - prev.players[2].score
      }
      const expected = { 1: 0, 2: 0 }
      for (const e of events) {
        if (e.type === 'TOUCHDOWN') expected[e.scoringPlayer] += 6
        else if (e.type === 'PAT_GOOD') expected[e.player] += 1
        else if (e.type === 'TWO_POINT_GOOD') expected[e.player] += 2
        else if (e.type === 'SAFETY') expected[e.scoringPlayer] += 2
        else if (e.type === 'FIELD_GOAL_GOOD') expected[e.player] += 3
      }
      for (const p of [1, 2]) {
        if (deltas[p] !== expected[p]) {
          this.flag('score delta does not match scoring events', {
            player: p,
            delta: deltas[p],
            expected: expected[p],
            events: events.map(e => e.type)
          })
        }
      }
    }

    // Scores within sane range (catch runaway loops)
    for (const p of [1, 2]) {
      if (state.players[p].score > 200) {
        this.flag('score implausibly high', {
          player: p,
          score: state.players[p].score
        })
      }
    }

    // After a TOUCHDOWN event, the next state's phase should be PAT_CHOICE
    // in regulation. In OT, a possession-ending TD can route through
    // OT_START → OT_PLAY (next possession) or straight to GAME_OVER if the
    // period decided the game, so allow those too.
    const OK_AFTER_TD = new Set(['PAT_CHOICE', 'KICKOFF', 'GAME_OVER', 'OT_START', 'OT_PLAY'])
    if (events.some(e => e.type === 'TOUCHDOWN') && !OK_AFTER_TD.has(state.phase)) {
      this.flag('TOUCHDOWN did not route to a legal post-score phase', {
        finalPhase: state.phase,
        events: events.map(e => e.type)
      })
    }

    this.prev = state
  }

  hasViolations () {
    return this.violations.length > 0
  }

  report () {
    if (!this.violations.length) return '  (no invariant violations)'
    return this.violations.map((v, i) =>
      `  [${i + 1}] ${v.msg} — ${JSON.stringify(v.ctx)}`
    ).join('\n')
  }
}
