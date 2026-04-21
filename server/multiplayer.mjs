/**
 * FBG multiplayer relay server.
 *
 * Each game is a room keyed by a 6-character code. The host opens a
 * WebSocket to create the game; a remote opens a WebSocket to the same
 * code to join. Every message one client sends is broadcast to the OTHER
 * client in the room (plus recorded on the server for replay / audit).
 *
 * v5.1's Pusher-based multiplayer used the same message-passing pattern;
 * this file is a drop-in transport swap — nothing about the game flow on
 * the client changes. The server is a dumb relay here. Server-authoritative
 * play (engine on the server, cheat-proof) is Phase 3 session 2.
 *
 * Protocol:
 *   C → S:  { type: "create" }
 *   S → C:  { type: "created", code, role: "host" }
 *
 *   C → S:  { type: "join", code }
 *   S → C:  { type: "joined", role: "remote" }  // if ok
 *   S → C:  { type: "peer-joined" }             // sent to host
 *   S → C:  { type: "error", reason }           // if bad code / full
 *
 *   C → S:  { type: "relay", payload: <anything> }
 *   S → C:  { type: "relay", payload: <anything> }  // forwarded to peer
 *
 *   Server also emits { type: "peer-disconnected" } when the other side
 *   closes.
 */

import { WebSocketServer } from 'ws'

function randomCode () {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

export function attachMultiplayer (server) {
  const wss = new WebSocketServer({ server, path: '/api/ws' })

  /** code -> { host: WebSocket|null, remote: WebSocket|null, createdAt: number } */
  const games = new Map()

  function partnerOf (game, ws) {
    if (game.host === ws) return game.remote
    if (game.remote === ws) return game.host
    return null
  }

  function send (ws, msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
  }

  wss.on('connection', (ws) => {
    let boundGame = null
    let role = null

    ws.on('message', (raw) => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.type === 'create') {
        let code = randomCode()
        while (games.has(code)) code = randomCode()
        const game = { host: ws, remote: null, createdAt: Date.now() }
        games.set(code, game)
        boundGame = game
        role = 'host'
        send(ws, { type: 'created', code, role })
        return
      }

      if (msg.type === 'join') {
        const code = String(msg.code || '').toUpperCase()
        const game = games.get(code)
        if (!game) return send(ws, { type: 'error', reason: 'no-such-game' })
        if (game.remote) return send(ws, { type: 'error', reason: 'game-full' })
        game.remote = ws
        boundGame = game
        role = 'remote'
        send(ws, { type: 'joined', role })
        send(game.host, { type: 'peer-joined' })
        return
      }

      if (msg.type === 'relay') {
        if (!boundGame) return
        const peer = partnerOf(boundGame, ws)
        send(peer, { type: 'relay', payload: msg.payload })
        return
      }
    })

    ws.on('close', () => {
      if (!boundGame) return
      const peer = partnerOf(boundGame, ws)
      send(peer, { type: 'peer-disconnected' })
      if (boundGame.host === ws) boundGame.host = null
      if (boundGame.remote === ws) boundGame.remote = null
      // Clean up empty games.
      if (!boundGame.host && !boundGame.remote) {
        for (const [code, g] of games) if (g === boundGame) games.delete(code)
      }
    })
  })

  // Periodic garbage collection: games older than 6 hours with no one in them.
  setInterval(() => {
    const now = Date.now()
    for (const [code, g] of games) {
      if (!g.host && !g.remote && now - g.createdAt > 6 * 60 * 60 * 1000) {
        games.delete(code)
      }
    }
  }, 10 * 60 * 1000)

  return wss
}
