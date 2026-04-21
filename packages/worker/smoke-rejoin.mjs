/**
 * Rejoin / reconnect smoke test.
 *
 * - Open host + remote, init + START_GAME.
 * - Drop both connections.
 * - Reopen one client to the same game code.
 * - Assert: on connect, the DO sends { type: "state", state, events }
 *   with the post-START_GAME phase (COIN_TOSS, not INIT), proving state
 *   survived the disconnect and is sent to the re-joiner.
 */

import WebSocket from 'ws'

const HTTP = process.env.WORKER || 'http://localhost:8787'
const WS = HTTP.replace(/^http/, 'ws')

function openWs (url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const queue = []
    const waiters = []
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (waiters.length) waiters.shift()(msg)
      else queue.push(msg)
    })
    ws.once('open', () => resolve({
      ws,
      next: () => new Promise((resolve) => {
        if (queue.length) resolve(queue.shift())
        else waiters.push(resolve)
      })
    }))
    ws.once('error', reject)
  })
}

async function main () {
  const { code } = await fetch(`${HTTP}/api/games`, { method: 'POST' }).then(r => r.json())
  console.log('code:', code)

  // Start a game.
  const host = await openWs(`${WS}/api/ws?code=${code}`)
  await host.next() // welcome
  const remote = await openWs(`${WS}/api/ws?code=${code}`)
  await remote.next() // welcome
  await host.next()   // peer-joined

  host.ws.send(JSON.stringify({
    type: 'init',
    setup: { team1: 'NE', team2: 'GB', quarterLengthMinutes: 7 }
  }))
  await host.next() // initial state
  await remote.next()

  host.ws.send(JSON.stringify({
    type: 'action',
    action: { type: 'START_GAME', quarterLengthMinutes: 7, teams: { 1: 'NE', 2: 'GB' } }
  }))
  const afterStart = await host.next()
  await remote.next()
  if (afterStart.state.phase !== 'COIN_TOSS') {
    throw new Error('setup phase wrong: ' + afterStart.state.phase)
  }

  // Drop both sides.
  host.ws.close()
  remote.ws.close()
  await new Promise((r) => setTimeout(r, 150))

  // Reconnect — the DO should send current state immediately after welcome.
  const rejoiner = await openWs(`${WS}/api/ws?code=${code}`)
  const welcome = await rejoiner.next()
  if (welcome.type !== 'welcome') throw new Error('no welcome: ' + JSON.stringify(welcome))

  const state = await rejoiner.next()
  if (state.type !== 'state') throw new Error('expected state on reconnect, got: ' + JSON.stringify(state))
  if (state.state.phase !== 'COIN_TOSS') {
    throw new Error('state phase wrong: ' + state.state.phase)
  }
  if (state.state.players[1].team.id !== 'NE' || state.state.players[2].team.id !== 'GB') {
    throw new Error('teams not preserved across reconnect')
  }

  rejoiner.ws.close()
  console.log('✅ rejoin smoke passed')
  process.exit(0)
}

main().catch(e => { console.error('❌', e); process.exit(1) })
