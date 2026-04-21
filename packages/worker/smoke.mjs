/**
 * Smoke test against a running Worker (local or deployed).
 * Usage: node smoke.mjs  (defaults to http://localhost:8787)
 *        WORKER=https://fbg-worker.your.workers.dev node smoke.mjs
 */

import WebSocket from 'ws'

const HTTP = process.env.WORKER || 'http://localhost:8787'
const WS = HTTP.replace(/^http/, 'ws')

/**
 * Open a WebSocket and start buffering messages immediately so nothing
 * is lost between connect and the first `next()` call.
 */
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
  const res = await fetch(`${HTTP}/api/games`, { method: 'POST' })
  const { code } = await res.json()
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('bad code: ' + code)
  console.log('got code:', code)

  const host = await openWs(`${WS}/api/ws?code=${code}`)
  const hostWelcome = await host.next()
  if (hostWelcome.type !== 'welcome' || hostWelcome.role !== 'host') {
    throw new Error('host welcome wrong: ' + JSON.stringify(hostWelcome))
  }

  const remote = await openWs(`${WS}/api/ws?code=${code}`)
  const remoteWelcome = await remote.next()
  if (remoteWelcome.type !== 'welcome' || remoteWelcome.role !== 'remote') {
    throw new Error('remote welcome wrong: ' + JSON.stringify(remoteWelcome))
  }

  const peerJoined = await host.next()
  if (peerJoined.type !== 'peer-joined') throw new Error('no peer-joined: ' + JSON.stringify(peerJoined))

  // Relay host -> remote
  host.ws.send(JSON.stringify({ type: 'relay', payload: { event: 'client-value', data: { value: 42 } } }))
  const r1 = await remote.next()
  if (r1.payload?.data?.value !== 42) throw new Error('relay failed: ' + JSON.stringify(r1))

  // Relay remote -> host
  remote.ws.send(JSON.stringify({ type: 'relay', payload: { event: 'client-value', data: { value: 'pong' } } }))
  const r2 = await host.next()
  if (r2.payload?.data?.value !== 'pong') throw new Error('reverse relay failed')

  host.ws.close(); remote.ws.close()
  console.log('✅ worker relay smoke test passed')
  process.exit(0)
}

main().catch(e => { console.error('❌', e); process.exit(1) })
