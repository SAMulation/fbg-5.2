/**
 * Headless FBG multiplayer client.
 *
 * Speaks the same wire protocol as the browser client (see
 * packages/worker/src/index.ts + game-room.ts):
 *   - POST /api/games            -> { code }
 *   - WS   /api/ws?code=<code>   -> welcome, peer-joined, relay, state
 *
 * Bots send { type: "action", action } via the Durable Object and consume
 * { type: "state", state, events } broadcasts. No DOM, no animations —
 * just protocol + a pluggable strategy for picking plays.
 */

import WebSocket from 'ws'

export class HeadlessClient {
  /**
   * @param {object} opts
   * @param {string} opts.wsBase    e.g. "ws://localhost:8787"
   * @param {string} opts.httpBase  e.g. "http://localhost:8787"
   * @param {"host"|"remote"} opts.role
   * @param {string} opts.code      game code from POST /api/games
   * @param {object} opts.team      team metadata (at minimum { abrv })
   * @param {object} opts.strategy  see strategies.mjs
   * @param {number} [opts.qtrLengthMinutes]
   * @param {(line: string) => void} [opts.log]
   */
  constructor (opts) {
    this.wsBase = opts.wsBase
    this.httpBase = opts.httpBase
    this.role = opts.role
    this.code = opts.code
    this.team = opts.team
    this.strategy = opts.strategy
    this.qtrLengthMinutes = opts.qtrLengthMinutes ?? 7
    this.log = opts.log || (() => {})

    this.me = this.role === 'host' ? 1 : 2
    this.opp = this.me === 1 ? 2 : 1
    this.ws = null
    this.engineState = null
    this.actionsDispatched = 0
    this.eventQueue = []
    this.eventWaiters = []
    this.events = [] // accumulated over the whole game
  }

  // ---------- low-level socket plumbing ----------

  async connect () {
    const ws = new WebSocket(`${this.wsBase}/api/ws?code=${this.code}`)
    this.ws = ws
    // Attach the message listener BEFORE 'open'. If we waited until after,
    // a welcome sent by the server on connection could race our listener
    // and be silently dropped.
    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (this.eventWaiters.length) this.eventWaiters.shift()(msg)
      else this.eventQueue.push(msg)
    })
    await new Promise((resolve, reject) => {
      ws.once('open', resolve)
      ws.once('error', reject)
    })
    const welcome = await this._nextMsg()
    if (welcome.type !== 'welcome' || welcome.role !== this.role) {
      throw new Error('unexpected welcome: ' + JSON.stringify(welcome))
    }
  }

  close () {
    if (this.ws) this.ws.close()
  }

  _nextMsg () {
    if (this.eventQueue.length) return Promise.resolve(this.eventQueue.shift())
    return new Promise((resolve) => this.eventWaiters.push(resolve))
  }

  _send (obj) {
    this.ws.send(JSON.stringify(obj))
  }

  /** Wait until we see a { type: "state", ... } broadcast. */
  async _nextState () {
    for (;;) {
      const msg = await this._nextMsg()
      if (msg.type === 'state') {
        this.engineState = msg.state
        for (const e of msg.events) this.events.push(e)
        return msg
      }
      // Ignore welcome/peer-joined/peer-disconnected/relay messages here.
    }
  }

  /** Wait until we see a specific relayed event (e.g. "setup"). */
  async _nextRelay (eventName) {
    for (;;) {
      const msg = await this._nextMsg()
      if (msg.type === 'relay' && msg.payload && msg.payload.event === eventName) {
        return msg.payload.data
      }
    }
  }

  // ---------- high-level setup ----------

  /**
   * Wait for both peers to be in the room. Host waits for peer-joined;
   * remote's welcome implicitly means the peer is already there.
   */
  async waitForPeer () {
    if (this.role === 'remote') return // remote is the second to arrive
    for (;;) {
      const msg = await this._nextMsg()
      if (msg.type === 'peer-joined') return
      // Anything else — ignore and keep waiting.
    }
  }

  /**
   * Exchange setup info with the peer (team + host-chosen game options)
   * then (host only) dispatch INIT + START_GAME on the DO.
   */
  async setup () {
    const mySetup = this.role === 'host'
      ? { team: this.team, qtrLength: this.qtrLengthMinutes, home: 1 }
      : { team: this.team }

    this._send({ type: 'relay', payload: { event: 'setup', data: mySetup } })
    const theirSetup = await this._nextRelay('setup')

    const team1 = this.role === 'host' ? this.team : theirSetup.team
    const team2 = this.role === 'host' ? theirSetup.team : this.team

    if (this.role === 'host') {
      this._send({
        type: 'init',
        setup: {
          team1: team1.abrv,
          team2: team2.abrv,
          quarterLengthMinutes: this.qtrLengthMinutes
        }
      })
    }
    await this._nextState()

    if (this.role === 'host') {
      this._send({
        type: 'action',
        action: {
          type: 'START_GAME',
          quarterLengthMinutes: this.qtrLengthMinutes,
          teams: { 1: team1.abrv, 2: team2.abrv }
        }
      })
    }
    await this._nextState()
  }

  // ---------- main loop ----------

  /**
   * Play until GAME_OVER event (or until the `maxActions` safety budget
   * is exhausted, so a broken game can't spin forever). Returns a per-
   * client game report.
   */
  async play (maxActions = 500) {
    while (!this._isGameOver()) {
      if (this.actionsDispatched >= maxActions) {
        this.log('hit maxActions budget')
        break
      }
      await this._step()
    }
    return this._report()
  }

  _isGameOver () {
    return this.events.some(e => e.type === 'GAME_OVER') ||
           (this.engineState && this.engineState.phase === 'GAME_OVER')
  }

  /**
   * Drive one phase-appropriate action. Only the "responsible" client for
   * a given phase dispatches; the other waits for the broadcast.
   */
  async _step () {
    const s = this.engineState
    const phase = s.phase

    switch (phase) {
      case 'COIN_TOSS':
        await this._doCoinToss()
        break
      case 'KICKOFF':
        await this._doKickoff()
        break
      case 'REG_PLAY':
      case 'OT_PLAY':
        await this._doPlay()
        break
      case 'PAT_CHOICE':
        await this._doPAT()
        break
      case 'TWO_PT_CONV':
        await this._doTwoPoint()
        break
      case 'OT_START':
        await this._doOTStart()
        break
      default:
        this.log('unhandled phase: ' + phase + ' — tick clock and hope')
        await this._tickAndWait(30)
        break
    }
  }

  // Host dispatches. We let the coin-toss winner choose receive.
  async _doCoinToss () {
    if (this.role === 'host') {
      this._dispatch({ type: 'COIN_TOSS_CALL', player: 1, call: this.strategy.coinCall(this.engineState) })
    }
    const afterToss = await this._nextState()
    const result = afterToss.events.find(e => e.type === 'COIN_TOSS_RESULT')
    const winner = result ? result.winner : 1
    if (winner === this.me) {
      this._dispatch({
        type: 'RECEIVE_CHOICE',
        player: this.me,
        choice: this.strategy.receiveOrDefer(this.engineState)
      })
    }
    // Both wait for the post-RECEIVE_CHOICE broadcast.
    await this._nextState()
  }

  async _doKickoff () {
    if (this.role === 'host') this._dispatch({ type: 'RESOLVE_KICKOFF' })
    await this._nextState()
  }

  async _doPlay () {
    const pick = this.strategy.pickPlay(this.engineState, this.me)
    const amOffense = this.engineState.field.offense === this.me
    if (amOffense && (pick === 'FG' || pick === 'PUNT')) {
      this._dispatch({
        type: 'FOURTH_DOWN_CHOICE',
        player: this.me,
        choice: pick === 'FG' ? 'fg' : 'punt'
      })
    } else {
      this._dispatch({ type: 'PICK_PLAY', player: this.me, play: pick })
    }

    const terminalEvents = new Set([
      'PLAY_RESOLVED', 'TOUCHDOWN', 'SAFETY', 'TURNOVER', 'TURNOVER_ON_DOWNS',
      'FIELD_GOAL_GOOD', 'FIELD_GOAL_MISSED', 'PUNT', 'PENALTY',
      'BIG_PLAY', 'TWO_POINT_GOOD', 'TWO_POINT_FAILED'
    ])
    for (;;) {
      const msg = await this._nextState()
      // Resolution is done when we see any terminal event, OR when the
      // state's pendingPick is cleared after having been filled (covers
      // special plays whose only event is informational).
      const hasTerminal = msg.events.some(e => terminalEvents.has(e.type))
      const pendingCleared = !msg.state.pendingPick.offensePlay &&
                             !msg.state.pendingPick.defensePlay &&
                             msg.events.some(e => e.type === 'PLAY_CALLED')
      if (hasTerminal || pendingCleared) break
    }

    if (!this._isGameOver()) {
      await this._tickAndWait(30)
    }
  }

  async _doPAT () {
    const amOffense = this.engineState.field.offense === this.me
    if (amOffense) {
      this._dispatch({
        type: 'PAT_CHOICE',
        player: this.me,
        choice: this.strategy.patChoice(this.engineState)
      })
    }
    await this._nextState()
  }

  async _doTwoPoint () {
    // Both sides PICK_PLAY at ballOn = 97. Engine currently runs
    // resolveRegularPlay on PICK_PLAY regardless of phase; close enough.
    await this._doPlay()
  }

  async _doOTStart () {
    if (this.role === 'host') this._dispatch({ type: 'START_OT_POSSESSION' })
    await this._nextState()
  }

  async _tickAndWait (seconds) {
    if (this.role !== 'host') {
      // Only host ticks the clock so we don't double-decrement.
      await this._nextState()
      return
    }
    this._dispatch({ type: 'TICK_CLOCK', seconds })
    await this._nextState()
  }

  _dispatch (action) {
    this.actionsDispatched++
    this._send({ type: 'action', action })
  }

  // ---------- reporting ----------

  _report () {
    const p1Score = this.engineState?.players[1]?.score ?? 0
    const p2Score = this.engineState?.players[2]?.score ?? 0
    const gameOver = this.events.find(e => e.type === 'GAME_OVER')
    return {
      role: this.role,
      me: this.me,
      actionsDispatched: this.actionsDispatched,
      totalEvents: this.events.length,
      finalPhase: this.engineState?.phase,
      finalQuarter: this.engineState?.clock?.quarter,
      secondsRemaining: this.engineState?.clock?.secondsRemaining,
      scores: { 1: p1Score, 2: p2Score },
      winner: gameOver?.winner ?? null,
      eventHistogram: this._histogram(),
      gameOver: !!gameOver
    }
  }

  _histogram () {
    const h = {}
    for (const e of this.events) h[e.type] = (h[e.type] || 0) + 1
    return h
  }
}
