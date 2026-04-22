/**
 * Narrator — subscribes to a LocalChannel's 'server-state' broadcasts
 * and converts each (state, events) pair into human-readable play-by-play.
 *
 * Used by the narrative harness (driver-narrative.mjs) to turn a
 * headless CPU-vs-CPU game into a transcript we can audit for rules
 * correctness and football plausibility.
 *
 * Design note: the narrator is purely observational — it never touches
 * state and never interferes with the driver. Both the driver and the
 * narrator bind to 'server-state' independently; each broadcast is
 * delivered to both.
 */

const KICK_TYPE_NAMES = {
  RK: 'Regular',
  OK: 'Onside',
  SK: 'Squib'
}

const RETURN_TYPE_NAMES = {
  RR: 'Regular Return',
  OR: 'Onside Counter',
  TB: 'Touchback'
}

const PLAY_NAMES = {
  SR: 'Short Run',
  LR: 'Long Run',
  SP: 'Short Pass',
  LP: 'Long Pass',
  TP: 'Trick Play',
  HM: 'Hail Mary',
  FG: 'Field Goal',
  PUNT: 'Punt',
  TWO_PT: '2-pt attempt'
}

const MATCHUP_QUALITY = ['Worst', 'Okay', 'Decent', 'Good', 'Best']

export class Narrator {
  constructor (channel) {
    this.channel = channel
    this.prevState = null
    this.lines = []
    this.currentQuarter = 0
    // Counters for summary
    this.stats = {
      plays: 0,
      firstDowns: 0,
      turnovers: 0,
      touchdowns: 0,
      fieldGoals: 0,
      fieldGoalsMissed: 0,
      safeties: 0,
      patGood: 0,
      twoPtGood: 0,
      twoPtFailed: 0,
      punts: 0,
      kickoffs: 0,
      onsideAttempts: 0,
      onsideRecovered: 0,
      touchbacks: 0,
      timeoutsCalled: 0
    }
  }

  start () {
    this.channel.bind('server-state', ({ state, events }) => {
      this.observe(state, events)
    })
  }

  line (s) {
    this.lines.push(s)
  }

  observe (state, events) {
    const prev = this.prevState
    const teamId = (p) => state.players[p].team.id

    // Preserve down/distance/ballOn FROM THE MOMENT the play was snapped
    // (before the reducer moved the ball). That's in `prev`.
    const snapState = prev
    const snapOffense = prev?.field?.offense
    const snapBallOn = prev?.field?.ballOn
    const snapDown = prev?.field?.down
    const snapFirstDownAt = prev?.field?.firstDownAt

    let playHeaderShown = false
    const snapWasKickoff = prev?.phase === 'KICKOFF'
    const showPlayHeader = () => {
      if (playHeaderShown || snapOffense == null || snapBallOn == null) return
      // Don't render a down-and-distance header for broadcasts that are
      // resolving a kickoff — the snap state's down/ballOn are leftover
      // from the pre-kickoff play, not a real line of scrimmage.
      if (snapWasKickoff) return
      playHeaderShown = true
      const toGo = Math.max(0, (snapFirstDownAt ?? 0) - snapBallOn)
      const time = snapState ? this.formatTime(snapState.clock) : '--:--'
      this.line('')
      this.line(
        `  [${time} | ${this.scoreLabel(snapState)} | ${this.toLabel(snapState)}] ` +
        `${teamId(snapOffense)} ${this.ordinal(snapDown)} & ${toGo === 0 ? 'Goal' : toGo} @ ${this.spotLabel(state, snapOffense, snapBallOn)}`
      )
    }

    for (const ev of events) {
      switch (ev.type) {
        case 'GAME_STARTED':
          this.line('--- Game starts ---')
          break

        case 'COIN_TOSS_RESULT':
          this.line(`Coin toss: ${ev.result} — ${teamId(ev.winner)} wins the toss`)
          break

        case 'KICKOFF':
          // Banner is emitted on phase transition above — skip the event.
          break

        case 'KICK_TYPE_CHOSEN':
          this.line(`  ${teamId(ev.player)} picks: ${KICK_TYPE_NAMES[ev.choice]} Kick (${ev.choice})`)
          if (ev.choice === 'OK') this.stats.onsideAttempts++
          break

        case 'RETURN_TYPE_CHOSEN':
          this.line(`  ${teamId(ev.player)} picks: ${RETURN_TYPE_NAMES[ev.choice]} (${ev.choice})`)
          break

        case 'TOUCHBACK':
          this.line(`  → Touchback. ${teamId(ev.receivingPlayer)} ball at the 25.`)
          this.stats.touchbacks++
          break

        case 'ONSIDE_KICK':
          if (ev.recovered) {
            this.line(`  → ONSIDE RECOVERED by ${teamId(ev.recoveringPlayer)}!`)
            this.stats.onsideRecovered++
          } else {
            this.line(`  → Onside kick failed. ${teamId(ev.recoveringPlayer)} takes possession.`)
          }
          break

        case 'KICKOFF_RETURN':
          this.line(`  → ${teamId(ev.returnerPlayer)} returns ${ev.yards} yards.`)
          break

        case 'PLAY_CALLED':
          // Collect for display on PLAY_RESOLVED.
          break

        case 'SAME_PLAY_COIN':
          showPlayHeader()
          this.line(`    Same-play coin flip: ${ev.outcome}`)
          break

        case 'TRICK_PLAY_ROLL':
          showPlayHeader()
          this.line(`    Trick Play roll: ${ev.outcome}`)
          break

        case 'HAIL_MARY_ROLL':
          showPlayHeader()
          this.line(`    Hail Mary roll: ${ev.outcome}`)
          break

        case 'BIG_PLAY':
          showPlayHeader()
          this.line(`    BIG PLAY for ${teamId(ev.beneficiary)} (subroll ${ev.subroll})`)
          break

        case 'PLAY_RESOLVED': {
          showPlayHeader()
          const matchup = MATCHUP_QUALITY[ev.matchupQuality] ?? ev.matchupQuality
          const offName = PLAY_NAMES[ev.offensePlay] ?? ev.offensePlay
          const defName = PLAY_NAMES[ev.defensePlay] ?? ev.defensePlay
          this.line(
            `    ${snapOffense ? teamId(snapOffense) : '?'} call: ${offName} vs ${defName} [${matchup}]`
          )
          this.line(
            `    Cards: ${ev.multiplier.card} (${ev.multiplier.value}×) × ${ev.yardsCard} = ${ev.yardsGained >= 0 ? '+' : ''}${ev.yardsGained} yd → ball @ ${ev.newBallOn}`
          )
          this.stats.plays++
          break
        }

        case 'FIRST_DOWN':
          this.line('    → First down')
          this.stats.firstDowns++
          break

        case 'TURNOVER':
          this.line(`    → TURNOVER (${ev.reason})`)
          this.stats.turnovers++
          break

        case 'TURNOVER_ON_DOWNS':
          this.line('    → Turnover on downs')
          break

        case 'PUNT':
          showPlayHeader()
          this.line(`    Punt — lands at ${ev.landingSpot}`)
          this.stats.punts++
          break

        case 'TOUCHDOWN': {
          this.line(`    *** TOUCHDOWN — ${teamId(ev.scoringPlayer)} ***`)
          this.stats.touchdowns++
          break
        }

        case 'FIELD_GOAL_GOOD':
          this.line(`    *** FIELD GOAL GOOD — ${teamId(ev.player)} ***`)
          this.stats.fieldGoals++
          break

        case 'FIELD_GOAL_MISSED':
          this.line(`    Field goal NO GOOD (${teamId(ev.player)})`)
          this.stats.fieldGoalsMissed++
          break

        case 'PAT_GOOD':
          this.line(`    PAT good — ${teamId(ev.player)} +1`)
          this.stats.patGood++
          break

        case 'TWO_POINT_GOOD':
          this.line(`    2-PT CONVERSION — ${teamId(ev.player)} +2`)
          this.stats.twoPtGood++
          break

        case 'TWO_POINT_FAILED':
          this.line(`    2-pt conversion failed (${teamId(ev.player)})`)
          this.stats.twoPtFailed++
          break

        case 'SAFETY':
          this.line(`    *** SAFETY — ${teamId(ev.scoringPlayer)} +2 ***`)
          this.stats.safeties++
          break

        case 'TIMEOUT_CALLED':
          this.line(`    [Timeout — ${teamId(ev.player)}, ${ev.remaining} remaining]`)
          this.stats.timeoutsCalled++
          break

        case 'TWO_MINUTE_WARNING':
          this.line('    [Two-minute warning]')
          break

        case 'QUARTER_ENDED': {
          this.line('')
          this.line(
            `=== End of Q${ev.quarter} | ${this.scoreLabel(state)} | ${this.toLabel(state)} ===`
          )
          this.currentQuarter = ev.quarter
          break
        }

        case 'HALF_ENDED':
          this.line('[End of first half]')
          break

        case 'OVERTIME_STARTED':
          this.line(`\n=== OT${ev.period} — ${state.players[ev.possession].team.id} first ===`)
          break

        case 'GAME_OVER': {
          const s1 = state.players[1].score
          const s2 = state.players[2].score
          const winner = ev.winner ? state.players[ev.winner].team.id : 'TIE'
          this.line('')
          this.line('=== GAME OVER ===')
          this.line(`Final: ${state.players[1].team.id} ${s1}, ${state.players[2].team.id} ${s2}`)
          this.line(`Winner: ${winner}`)
          break
        }

        // Silent events — kept out of the transcript but could be added for
        // deeper debugging.
        case 'CLOCK_TICKED':
        case 'DECK_SHUFFLED':
        case 'PENALTY':
          break

        default:
          this.line(`    [unhandled event: ${ev.type}]`)
      }
    }

    // Emit a kickoff banner on phase transitions TO 'KICKOFF', AFTER
    // any quarter/half/game events in this broadcast so the order reads
    // chronologically. Post-score and post-safety paths don't emit a
    // KICKOFF event — this fills the gap uniformly.
    if (prev && prev.phase !== 'KICKOFF' && state.phase === 'KICKOFF') {
      const kicker = state.field.offense
      const receiver = kicker === 1 ? 2 : 1
      const reason = state.isSafetyKick ? ' (free kick after safety)' : ''
      const time = this.formatTime(state.clock)
      this.line('')
      this.line(`[${time} | ${this.scoreLabel(state)} | ${this.toLabel(state)}] KICKOFF — ${teamId(kicker)} kicks to ${teamId(receiver)}${reason}`)
      this.stats.kickoffs++
    }

    this.prevState = state
  }

  // --- helpers ---

  scoreLabel (state) {
    if (!state) return '0-0'
    const id1 = state.players[1].team.id
    const id2 = state.players[2].team.id
    return `${id1} ${state.players[1].score}, ${id2} ${state.players[2].score}`
  }

  toLabel (state) {
    if (!state) return '3-3'
    return `TO: ${state.players[1].timeouts}-${state.players[2].timeouts}`
  }

  spotLabel (state, offense, ballOn) {
    const defId = state.players[offense === 1 ? 2 : 1].team.id
    if (ballOn === 50) return 'midfield'
    if (ballOn < 50) return `own ${ballOn}`
    return `${defId} ${100 - ballOn}`
  }

  ordinal (n) {
    if (n === 1) return '1st'
    if (n === 2) return '2nd'
    if (n === 3) return '3rd'
    if (n === 4) return '4th'
    return `${n}th`
  }

  formatTime (clock) {
    const mins = Math.floor(clock.secondsRemaining / 60)
    const secs = clock.secondsRemaining % 60
    return `Q${clock.quarter} ${mins}:${String(secs).padStart(2, '0')}`
  }

  transcript () {
    return this.lines.join('\n')
  }

  statsBlock () {
    const s = this.stats
    return [
      '--- Stats ---',
      `Plays run:        ${s.plays}`,
      `First downs:      ${s.firstDowns}`,
      `Turnovers:        ${s.turnovers}`,
      `Touchdowns:       ${s.touchdowns}`,
      `Field goals:      ${s.fieldGoals} / ${s.fieldGoals + s.fieldGoalsMissed}`,
      `Safeties:         ${s.safeties}`,
      `PAT good:         ${s.patGood}`,
      `2-pt good/failed: ${s.twoPtGood} / ${s.twoPtFailed}`,
      `Punts:            ${s.punts}`,
      `Kickoffs:         ${s.kickoffs}`,
      `Onside attempts:  ${s.onsideAttempts} (${s.onsideRecovered} recovered)`,
      `Touchbacks:       ${s.touchbacks}`,
      `Timeouts called:  ${s.timeoutsCalled}`
    ].join('\n')
  }
}
