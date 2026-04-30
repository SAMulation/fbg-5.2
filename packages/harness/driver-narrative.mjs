/**
 * Narrative harness — runs N full CPU-vs-CPU games and emits a
 * human-readable play-by-play for each. Intended for auditing
 * gameplay correctness ("does this actually look like football?")
 * not just deadlock validation.
 *
 * Usage:
 *   node driver-narrative.mjs                 # 3 games, 7-min quarters
 *   N=1 QTR=3 node driver-narrative.mjs       # 1 game, 3-min quarters
 *   OUT=transcript.txt node driver-narrative.mjs    # write transcript to file
 *
 * Notes:
 *   - Teams rotate through a small pool so different matchups surface.
 *   - CPU strategy is `random` (can occasionally call timeout, to exercise
 *     that path) — rematch it if you want deterministic picks.
 */

import { setupDomStub, installFastTimers, installSeededRandom, installFakeNow, realSetTimeout, realClearTimeout } from './dom-stub.mjs'
import { writeFileSync } from 'node:fs'

setupDomStub()
// Fast timers are safe here — local channel only, no fetch/WebSocket.
installFastTimers()
// Determinism: when SEED is set, pin Math.random + Date.now so the entire
// run (engine + CPU AI) is byte-reproducible. Without SEED, Math.random
// stays native — useful for fuzz-style audits.
const SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : null
if (SEED !== null && !Number.isNaN(SEED)) {
  installSeededRandom(SEED)
  installFakeNow()
  console.error(`[harness] deterministic mode: SEED=${SEED}`)
}

const { default: Game } = await import('../../public/js/game.js')
const { GameDriver } = await import('../../public/js/gameDriver.js')
const { createLocalPusher } = await import('../../public/js/localSession.js')
const { HarnessInput, randomStrategy } = await import('./harness-input.mjs')
const { Narrator } = await import('./narrator.mjs')
const { InvariantChecker } = await import('./invariants.mjs')

const N = parseInt(process.env.N || '3', 10)
const QTR = parseInt(process.env.QTR || '7', 10)
// CPU AI games are ~4x slower than pure random (alertBox paths + more
// broadcasts per kickoff with picks). 7-min quarters can take 3-5 minutes.
const TIMEOUT = parseInt(process.env.TIMEOUT || '300000', 10)
const OUT = process.env.OUT || ''

// Rotating matchups so the transcript covers different team ids.
// Indices into public/js/teams.js TEAMS list.
const MATCHUPS = [
  [0, 1], // SF vs CHI
  [14, 15], // GB vs DAL? (indices depend on ordering — just visual variety)
  [8, 11] // LAC vs COL?
]

function connectionFor (pusher) {
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

async function runOneGame (idx) {
  const [team1, team2] = MATCHUPS[idx % MATCHUPS.length]
  const pusher = createLocalPusher()
  const connection = connectionFor(pusher)
  const input = new HarnessInput(randomStrategy)

  const game = new Game(
    null, connection,
    team1, team2,
    0, 'reg', 1, QTR, false,
    null, null, input
  )
  game.animation = false

  // Subscribe narrator + invariants BEFORE driver starts so we catch
  // the first broadcast.
  const channel = pusher.subscribe()
  const narrator = new Narrator(channel)
  narrator.start()
  const invariants = new InvariantChecker(channel)
  invariants.start()

  const driver = new GameDriver(game.run, game)

  // Capture the timer handle so we can clear it on success — otherwise
  // the pending realSetTimeout keeps the Node event loop alive for the
  // full TIMEOUT window even after the game finishes (~5min idle per game
  // when batched, killing throughput).
  let timeoutHandle = null
  const timeout = new Promise((resolve, reject) => {
    timeoutHandle = realSetTimeout(
      () => reject(new Error('timed out after ' + TIMEOUT + 'ms')),
      TIMEOUT
    )
  })

  try {
    await Promise.race([driver.run_(), timeout])
    if (timeoutHandle) realClearTimeout(timeoutHandle)
    const state = driver.state
    return {
      idx,
      ok: true,
      transcript: narrator.transcript(),
      stats: narrator.statsBlock(),
      invariants: invariants.report(),
      violationCount: invariants.violations.length,
      finalState: state
    }
  } catch (err) {
    if (timeoutHandle) realClearTimeout(timeoutHandle)
    return {
      idx,
      ok: false,
      err: err.message || String(err),
      transcript: narrator.transcript(),
      stats: narrator.statsBlock(),
      invariants: invariants.report(),
      violationCount: invariants.violations.length,
      finalState: driver.state
    }
  }
}

async function main () {
  const pieces = []
  pieces.push('=========================================================')
  pieces.push(`FBG narrative harness — N=${N} quarters=${QTR}min CPU vs CPU`)
  if (SEED !== null && !Number.isNaN(SEED)) {
    pieces.push(`SEED=${SEED} (deterministic — same SEED + same args = byte-equal output)`)
  }
  pieces.push('=========================================================\n')

  for (let i = 0; i < N; i++) {
    pieces.push('\n╔════════════════════════════════════════╗')
    pieces.push(`║  GAME ${i + 1}                                 ║`)
    pieces.push('╚════════════════════════════════════════╝\n')
    const r = await runOneGame(i)
    pieces.push(r.transcript)
    pieces.push('\n' + r.stats)
    pieces.push('\n--- Invariants ---')
    pieces.push(r.invariants)
    if (!r.ok) pieces.push(`\n!!! GAME FAILED: ${r.err}`)
    if (r.violationCount > 0) {
      pieces.push(`\n!!! ${r.violationCount} INVARIANT VIOLATION(S) IN GAME ${i + 1}`)
    }
  }

  const output = pieces.join('\n')
  if (OUT) {
    writeFileSync(OUT, output)
    console.log(`wrote transcript to ${OUT}`)
  } else {
    console.log(output)
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
