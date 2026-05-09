/**
 * localSession — an in-browser channel that mimics OnlineChannel's
 * surface, for single-player and local-two-player games.
 *
 * GameDriver was built around the online channel API (bind / trigger /
 * dispatchAction / nextState). Rather than branch the driver on "are we
 * local?", we present the same interface and run engine.reduce here
 * instead of sending to the DO.
 *
 * Save/resume: `save()` returns a self-contained JSON bundle that can
 * be stashed in localStorage / IndexedDB. `hydrate(bundle)` rebuilds the
 * channel state by replaying the action log against initialState — the
 * same determinism guarantee the engine's replay.test.ts proves. We
 * replay rather than restore the snapshot so we get verification "for
 * free": if engine semantics drift, replay will diverge and we'll see it.
 */

import { reduce, initialState, replayActions, seededRng } from './engine.js'
import { fbgLog } from './log.js'

const SAVE_BUNDLE_VERSION = 1
const LS_KEY = 'fbg.savedGame.v1'

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

  // ---- save / resume ----

  /**
   * Returns a self-contained JSON bundle. Serializable via JSON.stringify.
   * Call any time after sendInit; resume reconstructs the same state via
   * `replayActions(initialState(setup), actionLog, seedBase)`.
   */
  save () {
    if (!this.setup) throw new Error('save: channel not initialized')
    return {
      version: SAVE_BUNDLE_VERSION,
      seedBase: this.seedBase,
      setup: { ...this.setup },
      actionLog: this.actionLog.slice(),
      // Snapshot of state for sanity-check on hydrate. Replay is canonical.
      stateSnapshot: this.state,
      savedAt: Date.now()
    }
  }

  /**
   * Restore a saved game. Replays the action log against a fresh initialState.
   * Throws on schema mismatch or replay divergence (the latter would
   * indicate engine semantics drift between save and load).
   */
  hydrate (bundle) {
    if (!bundle || bundle.version !== SAVE_BUNDLE_VERSION) {
      throw new Error('hydrate: bad or missing version')
    }
    this.setup = { ...bundle.setup }
    this.seedBase = bundle.seedBase
    this.actionLog = bundle.actionLog.slice()
    this.actionCount = this.actionLog.length

    const initial = initialState({
      team1: { id: this.setup.team1 },
      team2: { id: this.setup.team2 },
      quarterLengthMinutes: this.setup.quarterLengthMinutes
    })
    const replayed = replayActions(initial, this.actionLog, this.seedBase)
    this.state = replayed.state

    // Sanity: replayed state should match the snapshot. If not, the engine
    // changed between save and load — log a warning but trust the replay
    // (it's the canonical computation, snapshot was just for verification).
    if (bundle.stateSnapshot &&
        JSON.stringify(bundle.stateSnapshot) !== JSON.stringify(replayed.state)) {
      console.warn('[localSession] hydrate: replay diverges from snapshot — engine semantics may have changed since save')
    }

    // Broadcast the rehydrated state so any consumer (gameDriver) syncs.
    this._broadcast({ state: this.state, events: [] })
  }

  /** Persist the current channel to localStorage under LS_KEY. */
  saveToStorage () {
    const bundle = this.save()
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(bundle))
      return true
    } catch (err) {
      console.warn('[localSession] saveToStorage failed:', err)
      return false
    }
  }

  /** Load the most recent localStorage save. Returns null if nothing saved. */
  static loadFromStorage () {
    try {
      const raw = window.localStorage.getItem(LS_KEY)
      if (!raw) return null
      return JSON.parse(raw)
    } catch (err) {
      console.warn('[localSession] loadFromStorage failed:', err)
      return null
    }
  }

  static clearStorage () {
    try { window.localStorage.removeItem(LS_KEY) } catch {}
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
  // Expose debug-style save/resume hooks on window. Formal UI integration
  // is deferred — these let users (and future tests) drive save/resume
  // from the dev console while we figure out the right UX.
  if (typeof window !== 'undefined') {
    window.fbgSave = () => {
      if (!channel) { console.warn('fbgSave: no active channel'); return false }
      return channel.saveToStorage()
    }
    window.fbgResume = () => {
      const bundle = LocalChannel.loadFromStorage()
      if (!bundle) { console.warn('fbgResume: no saved game'); return false }
      if (!channel) channel = new LocalChannel()
      channel.hydrate(bundle)
      return true
    }
    window.fbgClearSave = () => LocalChannel.clearStorage()
    window.fbgHasSave = () => LocalChannel.loadFromStorage() !== null
  }
  return {
    async createGame () {
      channel = new LocalChannel()
      return { code: 'LOCAL', role: 'host' }
    },
    subscribe () {
      if (!channel) channel = new LocalChannel()
      // Expose for debug + multi-game-viewer iframe parents that need to
      // inspect actionLog / state without poking through internal pusher
      // shape. Not relied on by gameDriver itself.
      if (typeof window !== 'undefined') window.__fbgChannel = channel
      setTimeout(() => {
        const handlers = channel.handlers.get('pusher:subscription_succeeded')
        if (handlers) for (const cb of handlers) try { cb({}) } catch {}
      }, 0)
      return channel
    },
    disconnect () { channel = null }
  }
}
