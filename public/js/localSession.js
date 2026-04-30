/**
 * localSession — an in-browser channel that mimics OnlineChannel's
 * surface, for single-player and local-two-player games.
 *
 * GameDriver was built around the online channel API (bind / trigger /
 * dispatchAction / nextState). Rather than branch the driver on "are we
 * local?", we present the same interface and run engine.reduce here
 * instead of sending to the DO.
 */

import { reduce, initialState, seededRng } from './engine.js'
import { fbgLog } from './log.js'

class LocalChannel {
  constructor () {
    this.handlers = new Map()
    this.stateQueue = []
    this.stateWaiters = []
    this.state = null
    this.seedBase = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
    this.actionCount = 0
    // Append-only log of (setup, actions[]) for deterministic replay.
    // The harness can dump this to JSON on game end / on invariant
    // violation so any seed becomes a self-contained reproduction bundle.
    this.actionLog = []
    this.setup = null
  }

  // ---- channel surface (matches onlineChannel) ----

  bind (event, cb) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event).add(cb)
    return this
  }

  unbind (event, cb) {
    const set = this.handlers.get(event)
    if (!set) return this
    if (cb) set.delete(cb)
    else set.clear()
    return this
  }

  // Peer-relay trigger has no meaning locally. No-op.
  trigger (event, data) {}

  sendInit (setup) {
    if (this.state) {
      this._broadcast({ state: this.state, events: [] })
      return
    }
    this.setup = {
      team1: String(setup.team1 ?? '?'),
      team2: String(setup.team2 ?? '?'),
      quarterLengthMinutes: Number(setup.quarterLengthMinutes ?? 7)
    }
    const state = initialState({
      team1: { id: this.setup.team1 },
      team2: { id: this.setup.team2 },
      quarterLengthMinutes: this.setup.quarterLengthMinutes
    })
    this.state = state
    this._broadcast({ state, events: [] })
  }

  dispatchAction (action) {
    if (!this.state) {
      console.warn('localSession: dispatchAction before init')
      return
    }
    fbgLog('session', 'dispatch', action.type, action)
    this.actionLog.push(action)
    const rng = seededRng((this.seedBase + this.actionCount) >>> 0)
    this.actionCount++
    let result
    try {
      result = reduce(this.state, action, rng)
    } catch (err) {
      console.error('localSession reduce threw:', err)
      this._emit('server-error', { reason: String(err?.message || err) })
      return
    }
    this.state = result.state
    fbgLog('session', 'broadcast phase=' + result.state.phase,
      'events=[' + result.events.map((e) => e.type).join(',') + ']')
    this._broadcast({ state: result.state, events: result.events })
  }

  nextState () {
    return new Promise((resolve) => {
      if (this.stateQueue.length) resolve(this.stateQueue.shift())
      else this.stateWaiters.push(resolve)
    })
  }

  // ---- helpers ----

  _broadcast (payload) {
    this._emit('server-state', payload)
    if (this.stateWaiters.length) this.stateWaiters.shift()(payload)
    else this.stateQueue.push(payload)
  }

  _emit (event, payload) {
    const set = this.handlers.get(event)
    if (!set) return
    for (const cb of set) {
      try { cb(payload) } catch (e) { console.error('localChannel handler error:', e) }
    }
  }
}

/**
 * Pusher-shaped wrapper so script.js can hand it to the Game constructor
 * the same way it hands OnlineChannel.
 */
export function createLocalPusher () {
  let channel = null
  return {
    async createGame () {
      channel = new LocalChannel()
      return { code: 'LOCAL', role: 'host' }
    },
    subscribe () {
      if (!channel) channel = new LocalChannel()
      setTimeout(() => {
        const handlers = channel.handlers.get('pusher:subscription_succeeded')
        if (handlers) for (const cb of handlers) try { cb({}) } catch {}
      }, 0)
      return channel
    },
    disconnect () { channel = null }
  }
}
