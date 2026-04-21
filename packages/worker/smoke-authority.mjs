/**
 * Server-authority smoke test.
 *
 * Drives the Worker's new action/state protocol from a programmatic
 * client: two WebSockets, init a game, dispatch START_GAME + COIN_TOSS,
 * assert the state evolves on the server and is broadcast to both.
 *
 * Run while `wrangler dev` is up in another terminal, or wire into
 * `npm test` once CI is set up.
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

async function expect (client, pred, label) {
  const msg = await client.next()
  if (!pred(msg)) throw new Error(`${label}: got ${JSON.stringify(msg)}`)
  return msg
}

async function main () {
  const { code } = await fetch(`${HTTP}/api/games`, { method: 'POST' }).then(r => r.json())
  console.log('code:', code)

  const host = await openWs(`${WS}/api/ws?code=${code}`)
  await expect(host, m => m.type === 'welcome' && m.role === 'host', 'host welcome')

  const remote = await openWs(`${WS}/api/ws?code=${code}`)
  await expect(remote, m => m.type === 'welcome' && m.role === 'remote', 'remote welcome')
  await expect(host, m => m.type === 'peer-joined', 'host peer-joined')

  // Initialize the game from the host.
  host.ws.send(JSON.stringify({
    type: 'init',
    setup: { team1: 'NE', team2: 'GB', quarterLengthMinutes: 7 }
  }))

  const initState1 = await expect(host, m => m.type === 'state', 'host init state')
  const initState2 = await expect(remote, m => m.type === 'state', 'remote init state')

  if (initState1.state.phase !== 'INIT') throw new Error('init phase wrong: ' + initState1.state.phase)
  if (initState1.state.clock.quarter !== 0) throw new Error('init quarter wrong')
  if (JSON.stringify(initState1.state) !== JSON.stringify(initState2.state)) {
    throw new Error('host and remote saw different initial states')
  }

  // Dispatch START_GAME.
  host.ws.send(JSON.stringify({
    type: 'action',
    action: { type: 'START_GAME', quarterLengthMinutes: 7, teams: { 1: 'NE', 2: 'GB' } }
  }))

  const afterStart = await expect(host, m => m.type === 'state', 'host after START_GAME')
  await expect(remote, m => m.type === 'state', 'remote after START_GAME')

  if (afterStart.state.phase !== 'COIN_TOSS') throw new Error('phase after START_GAME: ' + afterStart.state.phase)
  if (!afterStart.events.some(e => e.type === 'GAME_STARTED')) throw new Error('no GAME_STARTED event')

  // Coin toss call from the host.
  host.ws.send(JSON.stringify({
    type: 'action',
    action: { type: 'COIN_TOSS_CALL', player: 1, call: 'heads' }
  }))

  const afterCoin = await expect(host, m => m.type === 'state', 'host after COIN_TOSS_CALL')
  if (!afterCoin.events.some(e => e.type === 'COIN_TOSS_RESULT')) throw new Error('no COIN_TOSS_RESULT event')

  // Verify replay determinism: the action log + seed must reconstruct the
  // same state. (We don't have access to the DO's storage from the smoke
  // test, but we can verify both clients see identical state post-dispatch.)
  const remoteAfterCoin = await expect(remote, m => m.type === 'state', 'remote after COIN_TOSS_CALL')
  if (JSON.stringify(afterCoin.state) !== JSON.stringify(remoteAfterCoin.state)) {
    throw new Error('host and remote diverged after coin toss')
  }

  host.ws.close(); remote.ws.close()
  console.log('✅ server-authority smoke test passed')
  process.exit(0)
}

main().catch(e => { console.error('❌', e); process.exit(1) })
