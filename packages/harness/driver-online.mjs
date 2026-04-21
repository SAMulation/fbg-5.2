/**
 * Dual-client online harness.
 *
 * Spins up TWO GameDriver instances in the same Node process — one
 * host, one remote — each with its own Game, Run, GameDriver,
 * OnlineChannel. They talk to a locally-running Cloudflare Worker + DO
 * over WebSockets exactly the way two browser tabs would. Picks come
 * from scripted strategies via HarnessInput.
 *
 * Catches online-multi sync bugs that the single-client local harness
 * can't: drain-loop deadlocks, stray broadcasts between players,
 * role-asymmetric race conditions.
 *
 * Usage:
 *   # Terminal 1:
 *   cd packages/worker && npx wrangler dev --port 8787 --local
 *   # Terminal 2:
 *   cd packages/harness && WORKER=http://localhost:8787 node driver-online.mjs
 *   # options:
 *   N=10 TIMEOUT=60000 STRATEGY=random LOG=driver node driver-online.mjs
 */

import { setupDomStub, installFastTimers, realSetTimeout } from './dom-stub.mjs'
import WebSocket from 'ws'

setupDomStub()
// Provide WebSocket in global scope — onlineChannel uses `new WebSocket(...)`.
globalThis.WebSocket = WebSocket
// FAST timers globally short-circuit setTimeout, which breaks Node's
// undici fetch + WebSocket connect paths that rely on real timer
// scheduling. Off by default for online; opt in with FAST=1 if you
// want to accept the risk to speed up in-game sleeps.
if (process.env.FAST === '1') installFastTimers()

const WORKER = process.env.WORKER || 'http://localhost:8787'
// Clients call apiBase() which reads location.port/host. Our stub sets
// port=3000 (so apiBase returns http://localhost:8787), but if the
// harness is pointed elsewhere we need location to reflect that.
if (!WORKER.includes('localhost:8787')) {
  const url = new URL(WORKER)
  globalThis.location = {
    search: '',
    protocol: url.protocol,
    host: url.host,
    port: url.port || ''
  }
}

const { default: Game } = await import('../../public/js/game.js')
const { GameDriver } = await import('../../public/js/gameDriver.js')
const { createOnlinePusher } = await import('../../public/js/onlineChannel.js')
const { setFbgLogNamespaces } = await import('../../public/js/log.js')
const { HarnessInput, randomStrategy, alwaysShortRunStrategy } = await import('./harness-input.mjs')

const N = parseInt(process.env.N || '1', 10)
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000', 10)
const LOG = process.env.LOG || ''
const STRATEGY = process.env.STRATEGY || 'random'
const QTR = parseInt(process.env.QTR || '1', 10)
const TEAM1 = parseInt(process.env.TEAM1 || '0', 10)
const TEAM2 = parseInt(process.env.TEAM2 || '1', 10)

if (LOG) setFbgLogNamespaces(LOG)

const strategies = {
  random: randomStrategy,
  always_sr: alwaysShortRunStrategy
}

function connectionFor (role, pusher, code) {
  const me = role === 'host' ? 1 : 2
  return {
    me,
    connections: [null, 'host', 'remote'],
    type: role,
    host: role === 'host',
    channel: null,
    gamecode: code,
    pusher
  }
}

async function runOneGame (idx) {
  const strategy = strategies[STRATEGY]
  if (!strategy) throw new Error('unknown strategy: ' + STRATEGY)

  // Ask the worker for a fresh game code, then open two client sockets.
  // `pusher.createGame` does both (creates + opens host's socket);
  // `pusher.joinGame` opens the remote's socket using that code.
  const hostPusher = createOnlinePusher()
  const remotePusher = createOnlinePusher()

  const { code } = await hostPusher.createGame()
  await remotePusher.joinGame(code)

  const hostInput = new HarnessInput(strategy)
  const remoteInput = new HarnessInput(strategy)

  const hostGame = new Game(
    null, connectionFor('host', hostPusher, code),
    TEAM1, TEAM2, 2, 'reg', 1, QTR, false, null, null, hostInput
  )
  const remoteGame = new Game(
    null, connectionFor('remote', remotePusher, code),
    // Remote picks their own team on join; engine ultimately comes from host.
    TEAM2, TEAM1, 2, 'reg', 1, QTR, false, null, null, remoteInput
  )
  hostGame.animation = false
  remoteGame.animation = false

  const hostDriver = new GameDriver(hostGame.run, hostGame)
  const remoteDriver = new GameDriver(remoteGame.run, remoteGame)

  const timeout = new Promise((resolve, reject) => {
    realSetTimeout(
      () => reject(new Error('game timed out after ' + TIMEOUT + 'ms')),
      TIMEOUT
    )
  })

  const start = Date.now()
  try {
    await Promise.race([
      Promise.all([hostDriver.run_(), remoteDriver.run_()]),
      timeout
    ])
    const dur = Date.now() - start
    // Both drivers should converge to GAME_OVER with the same scores.
    const hs = hostDriver.state
    const rs = remoteDriver.state
    const scoresMatch =
      hs.players[1].score === rs.players[1].score &&
      hs.players[2].score === rs.players[2].score
    if (hs.phase !== 'GAME_OVER' || rs.phase !== 'GAME_OVER' || !scoresMatch) {
      return {
        idx, ok: false, dur, code,
        err: 'drivers did not converge',
        host: `phase=${hs.phase} ${hs.players[1].score}-${hs.players[2].score}`,
        remote: `phase=${rs.phase} ${rs.players[1].score}-${rs.players[2].score}`
      }
    }
    return {
      idx, ok: true, dur, code,
      s1: hs.players[1].score, s2: hs.players[2].score
    }
  } catch (err) {
    const dur = Date.now() - start
    return {
      idx, ok: false, dur, code,
      err: err.message || String(err),
      host: 'phase=' + (hostDriver.state?.phase ?? '?'),
      remote: 'phase=' + (remoteDriver.state?.phase ?? '?'),
      stack: err.stack
    }
  } finally {
    try { hostPusher.disconnect() } catch {}
    try { remotePusher.disconnect() } catch {}
  }
}

async function main () {
  // Sanity: make sure the worker is up before spraying games at it.
  try {
    const probe = await fetch(`${WORKER}/api/games`, { method: 'POST' })
    if (!probe.ok) throw new Error('probe POST /api/games: ' + probe.status)
  } catch (err) {
    console.error(`[harness-online] worker not reachable at ${WORKER}: ${err.message}`)
    console.error(err.cause || err)
    console.error('  start it with: cd packages/worker && npx wrangler dev --port 8787 --local')
    process.exit(2)
  }

  console.log(`[harness-online] N=${N} strategy=${STRATEGY} qtrLength=${QTR} timeout=${TIMEOUT}ms worker=${WORKER}`)
  const results = []
  for (let i = 0; i < N; i++) {
    const r = await runOneGame(i)
    results.push(r)
    if (r.ok) {
      console.log(`  #${i} OK  ${r.dur}ms  code=${r.code}  score ${r.s1}-${r.s2}`)
    } else {
      console.error(`  #${i} FAIL ${r.dur}ms  code=${r.code}  err=${r.err}`)
      if (r.host) console.error(`     host:   ${r.host}`)
      if (r.remote) console.error(`     remote: ${r.remote}`)
      if (process.env.STACK) console.error(r.stack)
    }
  }
  const ok = results.filter((r) => r.ok).length
  const bad = results.length - ok
  console.log(`[harness-online] done. ok=${ok} fail=${bad}`)
  if (bad > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(2) })
