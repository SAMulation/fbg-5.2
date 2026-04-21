/* global location, WebSocket, fetch */
/**
 * onlineChannel — Pusher-compatible surface backed by a Cloudflare
 * Worker + Durable Object (see packages/worker/).
 *
 * v5.1's run.js uses channel.bind(event, cb) and channel.trigger(event, data);
 * this file mimics that surface so the existing multiplayer code paths
 * don't need to change.
 *
 * Protocol (Worker side — see packages/worker/src/index.ts):
 *   POST /api/games            -> { code }
 *   WS   /api/ws?code=<code>   -> game room DO
 *     C -> S  { type: "relay", payload }   broadcast to peer
 *     S -> C  { type: "welcome", role }    on connect (host | remote)
 *     S -> C  { type: "peer-joined" }      when second client arrives
 *     S -> C  { type: "relay", payload }   forwarded from peer
 *     S -> C  { type: "peer-disconnected" }
 */

function apiBase () {
  // Dev convention: static served at :3000, worker at :8787.
  // Prod convention: same origin (Worker serves static too).
  if (location.port === '3000') return 'http://localhost:8787'
  return `${location.protocol}//${location.host}`
}

function wsBase () {
  const http = apiBase()
  return http.replace(/^http/, 'ws')
}

class OnlineChannel {
  constructor () {
    this.handlers = new Map()
    this.ws = null
    this.ready = false
    this.code = null
    this.role = null
  }

  _emit (event, payload) {
    const set = this.handlers.get(event)
    if (!set) return
    for (const cb of set) {
      try { cb(payload) } catch (e) { console.error('channel handler error:', e) }
    }
  }

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

  trigger (event, data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('onlineChannel.trigger called while not open:', event)
      return
    }
    this.ws.send(JSON.stringify({ type: 'relay', payload: { event, data } }))
  }

  async _openSocket (code) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${wsBase()}/api/ws?code=${encodeURIComponent(code)}`)
      this.ws = ws
      ws.addEventListener('open', () => resolve())
      ws.addEventListener('error', (e) => reject(e))
      ws.addEventListener('message', (m) => this._onMessage(m))
      ws.addEventListener('close', () => {
        this.ready = false
        this._emit('pusher:member_removed', {})
      })
    })
  }

  _onMessage (m) {
    let msg
    try { msg = JSON.parse(m.data) } catch { return }

    if (msg.type === 'welcome') {
      this.role = msg.role
      // For a 'remote', we're already the second connection — channel is
      // ready to relay. For a 'host', we wait until peer-joined.
      if (this.role === 'remote') {
        this.ready = true
        this._emit('pusher:subscription_succeeded', {})
      }
      return
    }

    if (msg.type === 'peer-joined') {
      this.ready = true
      this._emit('pusher:subscription_succeeded', {})
      return
    }

    if (msg.type === 'relay') {
      const { event, data } = msg.payload || {}
      if (event) this._emit(event, data)
      return
    }

    if (msg.type === 'peer-disconnected') {
      this.ready = false
      this._emit('pusher:member_removed', {})
    }
  }

  async createGame () {
    const res = await fetch(`${apiBase()}/api/games`, { method: 'POST' })
    if (!res.ok) throw new Error('failed to create game')
    const { code } = await res.json()
    this.code = code
    await this._openSocket(code)
    return { code, role: 'host' }
  }

  async joinGame (code) {
    this.code = String(code).toUpperCase().trim()
    await this._openSocket(this.code)
    return new Promise((resolve, reject) => {
      const onOk = () => { this.unbind('pusher:subscription_succeeded', onOk); this.unbind('pusher:subscription_error', onErr); resolve({ role: this.role }) }
      const onErr = (e) => { this.unbind('pusher:subscription_succeeded', onOk); this.unbind('pusher:subscription_error', onErr); reject(new Error(e?.reason || 'join-failed')) }
      this.bind('pusher:subscription_succeeded', onOk)
      this.bind('pusher:subscription_error', onErr)
    })
  }

  disconnect () {
    if (this.ws) this.ws.close()
    this.ws = null
    this.ready = false
  }
}

/**
 * Pusher-shaped wrapper for script.js to hand to the Game constructor.
 */
export function createOnlinePusher () {
  let channel = null

  return {
    async createGame () {
      channel = new OnlineChannel()
      return await channel.createGame()
    },
    async joinGame (code) {
      channel = new OnlineChannel()
      return await channel.joinGame(code)
    },
    subscribe () {
      if (!channel) throw new Error('onlinePusher: subscribe() before createGame/joinGame')
      if (channel.ready) {
        setTimeout(() => channel._emit('pusher:subscription_succeeded', {}), 0)
      }
      return channel
    },
    disconnect () {
      if (channel) channel.disconnect()
      channel = null
    }
  }
}
