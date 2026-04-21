/**
 * Minimal smoke test: two WebSocket clients create + join a game, then
 * relay a message. Run with `node server/multiplayer.smoke.mjs` while
 * server-local.js is running on port 3000. Exits 0 on success, 1 on fail.
 */

import WebSocket from 'ws'

const URL = process.env.URL || 'ws://localhost:3000/api/ws'

function openClient () {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

function nextMsg (ws) {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString())))
  })
}

async function main () {
  const host = await openClient()
  host.send(JSON.stringify({ type: 'create' }))
  const created = await nextMsg(host)
  if (created.type !== 'created' || !created.code) throw new Error('no code')
  console.log('host got code:', created.code)

  const remote = await openClient()
  remote.send(JSON.stringify({ type: 'join', code: created.code }))
  const joined = await nextMsg(remote)
  if (joined.type !== 'joined') throw new Error('join failed: ' + JSON.stringify(joined))

  const hostPeerJoined = await nextMsg(host)
  if (hostPeerJoined.type !== 'peer-joined') throw new Error('host did not see peer-joined')

  // Relay test: host -> remote
  host.send(JSON.stringify({ type: 'relay', payload: { event: 'client-value', data: { value: 42 } } }))
  const relayed = await nextMsg(remote)
  if (relayed.type !== 'relay' || relayed.payload?.data?.value !== 42) {
    throw new Error('relay failed: ' + JSON.stringify(relayed))
  }

  // Relay back: remote -> host
  remote.send(JSON.stringify({ type: 'relay', payload: { event: 'client-value', data: { value: 'pong' } } }))
  const pong = await nextMsg(host)
  if (pong.payload?.data?.value !== 'pong') throw new Error('reverse relay failed')

  host.close(); remote.close()
  console.log('✅ multiplayer relay smoke test passed')
  process.exit(0)
}

main().catch(err => { console.error('❌', err); process.exit(1) })
