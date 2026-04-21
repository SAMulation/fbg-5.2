/**
 * onlineChannel — a Pusher-compatible channel backed by our own WebSocket.
 *
 * run.js uses channel.bind(event, cb) and channel.trigger(event, data);
 * onlineChannel mimics that surface exactly so the v5.1 multiplayer code
 * paths don't need to change.
 *
 *   channel.trigger('client-value', { value })   ->  server relays to peer
 *   channel.bind('client-value', cb)             ->  cb({ value }) on recv
 *   channel.bind('pusher:subscription_succeeded', cb)
 *   channel.bind('pusher:subscription_error', cb)
 *   channel.bind('pusher:member_removed', cb)   ->  when peer disconnects
 */

function wsUrl () {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/ws`
}

class OnlineChannel {
  constructor () {
    this.handlers = new Map() // event -> Set<cb>
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
    if (!this.ready) {
      console.warn('onlineChannel.trigger called before ready:', event)
      return
    }
    // v5.1 only uses 'client-value' — we relay anything, but the peer only
    // listens for the events it explicitly binds.
    this.ws.send(JSON.stringify({ type: 'relay', payload: { event, data } }))
  }

  async _open () {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl())
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

    if (msg.type === 'created') {
      this.code = msg.code
      this.role = 'host'
      // Host is connected to the room immediately, but we wait for the peer
      // before emitting subscription_succeeded — v5.1's run.js blocks on it
      // and then kicks off the handshake (which expects a peer).
      return
    }

    if (msg.type === 'joined') {
      this.role = 'remote'
      this.ready = true
      this._emit('pusher:subscription_succeeded', {})
      return
    }

    if (msg.type === 'peer-joined') {
      this.ready = true
      this._emit('pusher:subscription_succeeded', {})
      return
    }

    if (msg.type === 'error') {
      this._emit('pusher:subscription_error', msg)
      return
    }

    if (msg.type === 'relay') {
      const { event, data } = msg.payload || {}
      if (event) this._emit(event, data)
      return
    }

    if (msg.type === 'peer-disconnected') {
      this._emit('pusher:member_removed', {})
      this.ready = false
      return
    }
  }

  async createGame () {
    await this._open()
    this.ws.send(JSON.stringify({ type: 'create' }))
    // Wait for server to assign a code.
    await new Promise((resolve) => {
      const tick = setInterval(() => { if (this.code) { clearInterval(tick); resolve() } }, 10)
    })
    return { code: this.code, role: this.role }
  }

  async joinGame (code) {
    await this._open()
    this.ws.send(JSON.stringify({ type: 'join', code: String(code).toUpperCase() }))
    // Wait for either joined or error.
    return new Promise((resolve, reject) => {
      const onOk = () => { this.unbind('pusher:subscription_succeeded', onOk); this.unbind('pusher:subscription_error', onErr); resolve({ role: this.role }) }
      const onErr = (e) => { this.unbind('pusher:subscription_succeeded', onOk); this.unbind('pusher:subscription_error', onErr); reject(new Error(e.reason || 'join-failed')) }
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
 * Create a "pusher-like" object that returns an OnlineChannel when
 * subscribe() is called. This is what script.js passes to Game.
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
      // v5.1 calls pusher.subscribe(channelName). Our channel is already
      // scoped to the game, so we ignore the name and return the existing
      // channel. If subscribe is called before create/join, we fail loud.
      if (!channel) throw new Error('onlinePusher: subscribe() before createGame/joinGame')
      // If the handshake already completed (host sees peer-joined; remote
      // sees joined), v5.1 still awaits subscription_succeeded. Fire it on
      // the next tick so the await resolves.
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
