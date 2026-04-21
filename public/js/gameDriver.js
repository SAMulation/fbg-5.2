/**
 * gameDriver.js — THE play loop for all game modes.
 *
 * Drives a full game by reading the engine's GameState phase and
 * dispatching the appropriate action, then animating the result. Talks
 * to a channel-shaped session:
 *   • online-multi → onlineChannel → Cloudflare DO (server-authoritative)
 *   • single / double / computer → localSession (engine.reduce in-browser)
 *
 * Either way, the driver never touches v5.1's gameLoop, endPlay,
 * timeChanger, pickPlay, doPlay, calcDist, reportPlay, playMechanism,
 * or gameControl — every one of those carried hidden state assumptions
 * that fought the engine.
 */

/* global localStorage */
import { alertBox, sleep, setBallSpot, firstDownLine, resetBoardContainer } from './graphics.js'
import Player from './player.js'
import Team from './team.js'
import { TEAMS } from './teams.js'
import { animateResolution } from './animator.js'

const TERMINAL_EVENTS = new Set([
  'PLAY_RESOLVED', 'TOUCHDOWN', 'SAFETY', 'TURNOVER', 'TURNOVER_ON_DOWNS',
  'FIELD_GOAL_GOOD', 'FIELD_GOAL_MISSED', 'PUNT', 'PENALTY', 'BIG_PLAY',
  'TWO_POINT_GOOD', 'TWO_POINT_FAILED'
])

export class GameDriver {
  constructor (run, game) {
    this.run = run
    this.game = game
    this.channel = null
    this.state = null
  }

  get me () { return this.game.me }
  get opp () { return this.me === 1 ? 2 : 1 }
  get isLocal () { return !this.game.isMultiplayer() }
  // For local sessions the driver always dispatches. For online, only the
  // host dispatches resolver-level actions; the remote only dispatches its
  // own play-pick.
  get host () { return this.isLocal ? true : this.game.connection.host }

  // ------------- public entry -------------

  async run_ () { // can't call it `run` — collides with this.run
    try {
      await this._subscribe()
      let didRejoin = false
      if (!this.isLocal) {
        const rejoin = await this._awaitInitialState(400)
        if (rejoin && rejoin.phase !== 'INIT') {
          this._applyStateToGame(rejoin)
          this.state = rejoin
          didRejoin = true
          console.log('[driver] rejoined at phase:', rejoin.phase)
        }
      }
      if (!didRejoin) {
        await this._setupFresh()
      }

      await this.run.prepareHTML(this.game)

      while (this.state.phase !== 'GAME_OVER') {
        await this._driveOne()
      }
      await this._handleGameOver()
    } catch (e) {
      console.error('[driver] fatal:', e)
      await alertBox(this.run, 'Game error: ' + (e.message || e))
    }
  }

  // ------------- setup -------------

  async _subscribe () {
    this.channel = this.game.connection.pusher.subscribe(
      'private-game-' + (this.game.connection.gamecode || 'local')
    )
    this.run.channel = this.channel

    if (!this.isLocal) {
      // Legacy relay inbox — harmless; nothing in the driver reads it.
      this.channel.bind('client-value', (data) => {
        if (data && data.value !== null && data.value !== undefined) {
          this.run.inbox.enqueue(data.value)
        }
      })

      if (this.run.loadingPanelText) {
        this.run.loadingPanelText.innerText = 'Connecting to channel...'
      }
      await new Promise((resolve, reject) => {
        this.channel.bind('pusher:subscription_succeeded', resolve)
        this.channel.bind('pusher:subscription_error', reject)
      })
    }
  }

  async _awaitInitialState (ms) {
    return new Promise((resolve) => {
      let done = false
      const onState = (payload) => {
        if (done) return
        done = true
        this.channel.unbind('server-state', onState)
        resolve(payload.state)
      }
      this.channel.bind('server-state', onState)
      setTimeout(() => {
        if (done) return
        done = true
        this.channel.unbind('server-state', onState)
        resolve(null)
      }, ms)
    })
  }

  async _setupFresh () {
    const game = this.game

    if (!this.isLocal) {
      this.run.loadingPanelText.innerText = 'Waiting for other player...'

      // Relay team + game options to the peer.
      const mySetup = this.host
        ? { team: game.players[1].team, qtrLength: game.qtrLength, home: game.home }
        : { team: game.players[1].team }

      const theirSetupPromise = new Promise((resolve) => {
        const onSetup = (data) => {
          this.channel.unbind('setup', onSetup)
          resolve(data)
        }
        this.channel.bind('setup', onSetup)
      })
      this.channel.trigger('setup', mySetup)
      const theirSetup = await theirSetupPromise

      if (this.host) {
        game.players[2] = new Player(null, game, theirSetup.team)
      } else {
        const myOwn = game.players[1].team
        game.players[1] = new Player(null, game, theirSetup.team)
        game.players[2] = new Player(null, game, myOwn)
        if (theirSetup.qtrLength !== undefined) game.qtrLength = parseInt(theirSetup.qtrLength)
        if (theirSetup.home !== undefined) game.home = parseInt(theirSetup.home)
        game.away = game.opp(game.home)
        if (game.numberPlayers) game.me = 2
      }

      this.run.loadingPanelText.innerText = 'Starting game...'
    }

    if (this.host) {
      this.channel.sendInit({
        team1: game.players[1].team.abrv,
        team2: game.players[2].team.abrv,
        quarterLengthMinutes: game.qtrLength
      })
    }
    await this._nextState() // INIT state

    if (this.host) {
      this.channel.dispatchAction({
        type: 'START_GAME',
        quarterLengthMinutes: game.qtrLength,
        teams: { 1: game.players[1].team.abrv, 2: game.players[2].team.abrv }
      })
    }
    const afterStart = await this._nextState()
    this.state = afterStart.state
    this._applyStateToGame(this.state)
    this._stashResumeToken()
    console.log('[driver] setup complete, phase:', this.state.phase)
  }

  // ------------- main loop -------------

  async _driveOne () {
    console.log('[driver] phase=' + this.state.phase + ' offense=' + this.state.field.offense + ' down=' + this.state.field.down + ' ballOn=' + this.state.field.ballOn)
    switch (this.state.phase) {
      case 'COIN_TOSS': return this._doCoinToss()
      case 'KICKOFF': return this._doKickoff()
      case 'REG_PLAY':
      case 'OT_PLAY':
      case 'TWO_PT_CONV':
        return this._doPlay()
      case 'PAT_CHOICE': return this._doPat()
      case 'OT_START': return this._doOTStart()
      default:
        console.warn('[driver] unhandled phase:', this.state.phase)
        await sleep(500)
    }
  }

  async _doCoinToss () {
    const game = this.game
    const awayName = game.players[game.away].team.name
    const homeName = game.players[game.home].team.name

    await alertBox(this.run, awayName + ' calling the coin toss...')

    await firstDownLine(this.run, 1)
    this.run.ball.classList.toggle('fade', true)

    game.players[game.away].currentPlay = null
    const coinPick = await this.run.input.getInput(game, game.away, 'coin', awayName + ' pick for coin toss...')

    await alertBox(this.run, awayName + ' chose ' + (coinPick === 'H' ? 'heads' : 'tails') + '... The toss!')
    this.run.coinImage.classList.toggle('flip')
    await sleep(1500)

    if (this.host) {
      this.channel.dispatchAction({
        type: 'COIN_TOSS_CALL',
        player: game.away,
        call: coinPick === 'H' ? 'heads' : 'tails'
      })
    }
    const tossResult = await this._nextState()
    const result = tossResult.events.find(e => e.type === 'COIN_TOSS_RESULT')
    const actFlip = result.result === 'heads' ? 'H' : 'T'
    const winner = result.winner

    this.run.coinImage.classList.toggle('flip')
    if (actFlip === 'T') this.run.coinImage.classList.toggle('tails')
    await alertBox(this.run, 'It was ' + (actFlip === 'H' ? 'heads' : 'tails') + '!')
    await sleep(800)
    this.run.coinImage.classList.toggle('fade', true)
    this.run.ball.classList.toggle('fade', false)

    game.players[winner].currentPlay = null
    const decType = game.qtr >= 4 ? 'kickDecOT' : 'kickDecReg'
    const decPick = await this.run.input.getInput(game, winner, decType,
      game.players[winner].team.name + ' decide whether to kick or receive...')

    const wantsBallFirst = decPick === 'R' || decPick === '1'
    if (this.host) {
      this.channel.dispatchAction({
        type: 'RECEIVE_CHOICE',
        player: winner,
        choice: wantsBallFirst ? 'receive' : 'defer'
      })
    }
    const postReceive = await this._nextState()
    this._applyStateToGame(postReceive.state)

    const winnerName = winner === game.away ? awayName : homeName
    await alertBox(this.run, winnerName + ' ' + (wantsBallFirst ? 'will receive' : 'will kick') + '.')
  }

  async _doKickoff () {
    const game = this.game
    game.down = 0
    game.firstDown = 0
    this.run.playerContainer.classList.toggle('fade', true)
    game.spot = 65
    await setBallSpot(this.run)

    await alertBox(this.run, game.players[game.offNum].team.name + ' kicking off...')
    if (this.host) {
      this.channel.dispatchAction({ type: 'RESOLVE_KICKOFF' })
    }
    const { state, events } = await this._nextState()
    this._applyStateToGame(state)

    const receiverName = game.players[game.offNum].team.name
    const punt = events.find(e => e.type === 'PUNT')
    if (punt) {
      await alertBox(this.run, receiverName + ' take the ball at the ' + this._yardLineLabel(game.spot) + '.')
    }

    await setBallSpot(this.run)
    await firstDownLine(this.run)
    this.run.printMsgDown(game, this.run.scoreboardContainer)
    this.run.printMsgSpot(game, this.run.scoreboardContainer)

    game.players[1].currentPlay = '/'
    game.players[2].currentPlay = '/'
  }

  async _doPlay () {
    if (this.isLocal) return this._doPlayLocal()
    return this._doPlayOnline()
  }

  async _doPlayOnline () {
    const game = this.game
    this._resetPlayUI()

    console.log('[driver] awaiting local pick p=' + this.me)
    const myPlay = await this.run.input.getInput(
      game, this.me, 'reg',
      game.players[this.me].team.name + ' pick your play...'
    )
    console.log('[driver] local pick =', myPlay)
    game.players[this.me].currentPlay = myPlay

    const amOffense = this.state.field.offense === this.me
    let defenseDispatched = false
    if (amOffense) {
      if (myPlay === 'FG') {
        this.channel.dispatchAction({ type: 'FOURTH_DOWN_CHOICE', player: this.me, choice: 'fg' })
      } else if (myPlay === 'PUNT') {
        this.channel.dispatchAction({ type: 'FOURTH_DOWN_CHOICE', player: this.me, choice: 'punt' })
      } else {
        this.channel.dispatchAction({ type: 'PICK_PLAY', player: this.me, play: myPlay })
      }
    }

    const otherP = this.opp
    await alertBox(this.run, game.players[otherP].team.name + ' are picking their play...')

    const allEvents = []
    let resolved = null
    while (!resolved) {
      const { state, events } = await this._nextState()
      allEvents.push(...events)
      console.log('[driver] broadcast:', events.map(e => e.type).join(','))

      if (!amOffense && !defenseDispatched) {
        const offenseCalled = events.some(e => e.type === 'PLAY_CALLED' && e.player === this.state.field.offense)
        if (offenseCalled) {
          this.channel.dispatchAction({ type: 'PICK_PLAY', player: this.me, play: myPlay })
          defenseDispatched = true
        }
      }

      const hasTerminal = events.some(e => TERMINAL_EVENTS.has(e.type))
      const pendingCleared = !state.pendingPick.offensePlay &&
                             !state.pendingPick.defensePlay &&
                             events.some(e => e.type === 'PLAY_CALLED')
      if (hasTerminal || pendingCleared) {
        resolved = { state, events: allEvents }
      }
    }

    await this._animateAndScore(resolved.events, resolved.state)
    await this._tickClock(30)
  }

  async _doPlayLocal () {
    const game = this.game
    this._resetPlayUI()

    const offense = this.state.field.offense
    const defense = offense === 1 ? 2 : 1

    // Offense picks first.
    console.log('[driver-local] awaiting offense (p' + offense + ')')
    const offPlay = await this.run.input.getInput(
      game, offense, 'reg',
      game.players[offense].team.name + ' pick your play...'
    )
    console.log('[driver-local] offense picked =', offPlay)
    game.players[offense].currentPlay = offPlay

    // Fourth-down special choices short-circuit — they don't need a defense pick.
    if (offPlay === 'FG' || offPlay === 'PUNT') {
      this.channel.dispatchAction({
        type: 'FOURTH_DOWN_CHOICE', player: offense, choice: offPlay.toLowerCase()
      })
      const allEvents = await this._drainUntilResolved()
      await this._animateAndScore(allEvents, this.state)
      await this._tickClock(30)
      return
    }

    // Dispatch offense PICK_PLAY — engine stashes it in pendingPick; first
    // broadcast carries PLAY_CALLED for the offense but no resolution yet.
    this.channel.dispatchAction({ type: 'PICK_PLAY', player: offense, play: offPlay })
    const first = await this._nextState()
    const preEvents = first.events

    // Now defense.
    console.log('[driver-local] awaiting defense (p' + defense + ')')
    const defPlay = await this.run.input.getInput(
      game, defense, 'reg',
      game.players[defense].team.name + ' pick your play...'
    )
    console.log('[driver-local] defense picked =', defPlay)
    game.players[defense].currentPlay = defPlay

    this.channel.dispatchAction({ type: 'PICK_PLAY', player: defense, play: defPlay })
    const rest = await this._drainUntilResolved()
    const allEvents = [...preEvents, ...rest]

    await this._animateAndScore(allEvents, this.state)
    await this._tickClock(30)
  }

  _resetPlayUI () {
    const game = this.game
    resetBoardContainer(this.run)
    game.players[1].currentPlay = null
    game.players[2].currentPlay = null
    game.thisPlay.multiplierCard = null
    game.thisPlay.yardCard = null
    game.thisPlay.multiplier = null
    game.thisPlay.quality = null
    game.thisPlay.dist = null
    game.thisPlay.bonus = 0

    // Defensive: prepareAndGetUserInput awaits a slide-down REMOVE; force
    // the class on if it's drifted off, otherwise the await hangs.
    if (!this.run.cardsContainer.classList.contains('slide-down')) {
      this.run.cardsContainer.classList.add('slide-down')
    }
  }

  async _drainUntilResolved () {
    const allEvents = []
    while (true) {
      const { state, events } = await this._nextState()
      allEvents.push(...events)
      console.log('[driver] broadcast:', events.map(e => e.type).join(','))
      const hasTerminal = events.some(e => TERMINAL_EVENTS.has(e.type))
      const pendingCleared = !state.pendingPick.offensePlay &&
                             !state.pendingPick.defensePlay &&
                             events.some(e => e.type === 'PLAY_CALLED')
      if (hasTerminal || pendingCleared) return allEvents
    }
  }

  async _animateAndScore (allEvents, stateAtEnd) {
    const game = this.game
    for (const e of allEvents) {
      if (e.type === 'PLAY_CALLED') game.players[e.player].currentPlay = e.play
    }
    this._applyStateToGame(stateAtEnd || this.state)
    await animateResolution(this.run, game, allEvents, this.state)

    const tdEvent = allEvents.find((e) => e.type === 'TOUCHDOWN')
    const safetyEvent = allEvents.find((e) => e.type === 'SAFETY')
    const fgGood = allEvents.find((e) => e.type === 'FIELD_GOAL_GOOD')
    const twoGood = allEvents.find((e) => e.type === 'TWO_POINT_GOOD')
    if (tdEvent) await this.run.scoreChange(game, tdEvent.scoringPlayer, 6)
    if (safetyEvent) await this.run.scoreChange(game, safetyEvent.scoringPlayer, 2)
    if (fgGood) await this.run.scoreChange(game, fgGood.player, 3)
    if (twoGood) await this.run.scoreChange(game, twoGood.player, 2)
  }

  async _doPat () {
    const game = this.game
    const offense = this.state.field.offense
    const amOffense = this.me === offense

    let choice = 'kick'
    // Local: driver always prompts the offense (who may be CPU).
    // Online: only the client that IS the offense prompts & dispatches.
    if (this.isLocal || amOffense) {
      if (game.qtr >= 7) {
        choice = 'two_point'
      } else {
        const sel = await this.run.input.getInput(
          game, offense, 'pat',
          game.players[offense].team.name + ' pick PAT type...'
        )
        choice = sel === '2P' ? 'two_point' : 'kick'
      }
      this.channel.dispatchAction({ type: 'PAT_CHOICE', player: offense, choice })
    }

    const { state, events } = await this._nextState()
    this._applyStateToGame(state)

    if (events.some(e => e.type === 'PAT_GOOD')) {
      await this.run.fgAnimation(game, 22, true)
      await this.run.scoreChange(game, offense, 1)
    }
  }

  async _doOTStart () {
    if (this.host) {
      this.channel.dispatchAction({ type: 'START_OT_POSSESSION' })
    }
    const { state } = await this._nextState()
    this._applyStateToGame(state)
    await setBallSpot(this.run)
    await firstDownLine(this.run)
    this.run.printMsgDown(this.game, this.run.scoreboardContainer)
    this.run.printMsgSpot(this.game, this.run.scoreboardContainer)
  }

  async _tickClock (seconds) {
    if (this.host) {
      this.channel.dispatchAction({ type: 'TICK_CLOCK', seconds })
    }
    const { state, events } = await this._nextState()
    this._applyStateToGame(state)

    if (events.some(e => e.type === 'TWO_MINUTE_WARNING')) {
      await alertBox(this.run, 'Two-minute warning.')
    }
    if (events.some(e => e.type === 'QUARTER_ENDED')) {
      await alertBox(this.run, 'End of quarter.')
    }
    if (events.some(e => e.type === 'HALF_ENDED')) {
      await alertBox(this.run, 'Halftime.')
    }
    if (events.some(e => e.type === 'OVERTIME_STARTED')) {
      await alertBox(this.run, 'Overtime!')
    }
  }

  async _handleGameOver () {
    const state = this.state
    const winner = state.players[1].score > state.players[2].score ? 1 : 2
    const winnerName = this.game.players[winner].team.name
    const s1 = state.players[1].score
    const s2 = state.players[2].score
    await alertBox(this.run, winnerName + ' win ' + Math.max(s1, s2) + ' - ' + Math.min(s1, s2) + '!')
    this._clearResumeToken()
  }

  // ------------- helpers -------------

  async _nextState () {
    const { state, events } = await this.channel.nextState()
    this.state = state
    this.game.engineState = state
    return { state, events }
  }

  _applyStateToGame (state) {
    const game = this.game
    game.engineState = state
    game.spot = state.field.ballOn
    game.firstDown = state.field.firstDownAt
    game.down = state.field.down
    game.offNum = state.field.offense
    game.defNum = game.offNum === 1 ? 2 : 1
    game.qtr = state.clock.quarter
    game.qtrLength = state.clock.quarterLengthMinutes
    game.currentTime = state.clock.secondsRemaining / 60
    game.players[1].score = state.players[1].score
    game.players[2].score = state.players[2].score
    game.players[1].timeouts = state.players[1].timeouts
    game.players[2].timeouts = state.players[2].timeouts

    // Best-effort team sync on rejoin (teams may not match host/remote order)
    if (state.players[1].team?.id && game.players[1].team?.abrv !== state.players[1].team.id) {
      const t = TEAMS.find((x) => x.abrv === state.players[1].team.id)
      if (t) game.players[1].team = new Team(t)
    }
    if (state.players[2].team?.id && game.players[2].team?.abrv !== state.players[2].team.id) {
      const t = TEAMS.find((x) => x.abrv === state.players[2].team.id)
      if (t) game.players[2].team = new Team(t)
    }

    if (state.openingReceiver) game.recFirst = state.openingReceiver
    game.away = game.opp(game.home)
  }

  _yardLineLabel (ballOn) {
    if (ballOn === 50) return '50'
    if (ballOn < 50) return 'own ' + ballOn
    return 'opponent ' + (100 - ballOn)
  }

  _stashResumeToken () {
    if (this.isLocal) return
    try {
      localStorage.setItem('fbg:onlineResume', JSON.stringify({
        code: this.game.connection.gamecode,
        me: this.game.me,
        role: this.host ? 'host' : 'remote',
        savedAt: Date.now()
      }))
    } catch (e) { /* ignore */ }
  }

  _clearResumeToken () {
    try { localStorage.removeItem('fbg:onlineResume') } catch (e) { /* ignore */ }
  }
}
