/**
 * Headless local-game harness.
 *
 * Spins up the DOM stub, constructs a real Game + Run + GameDriver,
 * injects a scripted HarnessInput in place of ButtonInput, and runs
 * one or more single-player / local-double / 0-player games end to
 * end. Any hang or thrown error surfaces here instead of in a browser.
 *
 * Usage:
 *   node driver-local.mjs                        # 1 random single-player game
 *   N=10 node driver-local.mjs                   # 10 games
 *   MODE=double N=5 node driver-local.mjs        # local two-player
 *   LOG=driver,input,session node driver-local.mjs
 *   TIMEOUT=10000 node driver-local.mjs          # per-game timeout (ms)
 */

import { setupDomStub, installFastTimers, realSetTimeout } from './dom-stub.mjs'
setupDomStub()
if (process.env.FAST !== '0') installFastTimers()

const { default: Game } = await import('../../public/js/game.js')
const { GameDriver } = await import('../../public/js/gameDriver.js')
const { createLocalPusher } = await import('../../public/js/localSession.js')
const { setFbgLogNamespaces } = await import('../../public/js/log.js')
const { HarnessInput, randomStrategy, alwaysShortRunStrategy } = await import('./harness-input.mjs')

const MODE = process.env.MODE || 'single'
const N = parseInt(process.env.N || '1', 10)
// With situational CPU AI active, games that hit overtime can legitimately
// take longer (multiple OT periods if neither side scores). 60s absorbs
// most of the tail; ~1-2% of games can still run past this. Flagged as
// a potential bug — see memory: feedback_ot_timeout_tail.md.
const TIMEOUT = parseInt(process.env.TIMEOUT || '60000', 10)
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

function connectionFor (mode, pusher) {
  if (mode === 'single') {
    return {
      me: 1,
      connections: [null, 'local', 'computer'],
      type: 'single',
      host: true,
      channel: null,
      gamecode: 'LOCAL',
      pusher
    }
  }
  if (mode === 'double') {
    return {
      me: 1,
      connections: [null, 'local', 'local'],
      type: 'double',
      host: true,
      channel: null,
      gamecode: 'LOCAL',
      pusher
    }
  }
  if (mode === 'computer') {
    return {
      me: 0,
      connections: [null, 'computer', 'computer'],
      type: 'computer',
      host: true,
      channel: null,
      gamecode: 'LOCAL',
      pusher
    }
  }
  throw new Error('unknown mode: ' + mode)
}

function numberPlayersFor (mode) {
  if (mode === 'single') return 1
  if (mode === 'double') return 2
  if (mode === 'computer') return 0
  return 1
}

async function runOneGame (idx) {
  const strategy = strategies[STRATEGY]
  if (!strategy) throw new Error('unknown strategy: ' + STRATEGY)

  const pusher = createLocalPusher()
  const connection = connectionFor(MODE, pusher)
  const input = new HarnessInput(strategy)

  // Game constructor args: resume, connection, team1, team2, numberPlayers,
  // gameType, home, qtrLength, animation (false → short alertBox sleeps),
  // stats1, stats2, input.
  const game = new Game(
    null,
    connection,
    TEAM1,
    TEAM2,
    numberPlayersFor(MODE),
    'reg',
    1,
    QTR,
    false,
    null,
    null,
    input
  )
  // Quiet prepareHTML's real animations — with animation=false the
  // 750ms alert sleeps drop to 100ms, plenty for the stub.
  game.animation = false

  const driver = new GameDriver(game.run, game)

  const start = Date.now()
  const timeout = new Promise((resolve, reject) => {
    realSetTimeout(() => reject(new Error('game timed out after ' + TIMEOUT + 'ms')), TIMEOUT)
  })

  try {
    await Promise.race([driver.run_(), timeout])
    const dur = Date.now() - start
    const state = driver.state
    const s1 = state.players[1].score
    const s2 = state.players[2].score
    const winner = s1 > s2 ? 1 : s2 > s1 ? 2 : 0
    return { idx, ok: true, dur, s1, s2, winner, phase: state.phase }
  } catch (err) {
    const dur = Date.now() - start
    return {
      idx,
      ok: false,
      dur,
      err: err.message || String(err),
      phase: driver.state?.phase ?? '?',
      stack: err.stack
    }
  }
}

async function main () {
  console.log(`[harness] mode=${MODE} N=${N} strategy=${STRATEGY} qtrLength=${QTR} timeout=${TIMEOUT}ms`)
  const results = []
  for (let i = 0; i < N; i++) {
    const r = await runOneGame(i)
    results.push(r)
    if (r.ok) {
      console.log(`  #${i} OK  ${r.dur}ms  score ${r.s1}-${r.s2}  phase=${r.phase}`)
    } else {
      console.error(`  #${i} FAIL ${r.dur}ms  phase=${r.phase}  err=${r.err}`)
      if (process.env.STACK) console.error(r.stack)
    }
  }
  const ok = results.filter((r) => r.ok).length
  const bad = results.length - ok
  console.log(`[harness] done. ok=${ok} fail=${bad}`)
  if (bad > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(2) })
