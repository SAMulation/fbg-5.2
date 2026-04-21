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

import { setupDomStub, installFastTimers, realSetTimeout } from './dom-stub.mjs'
import { writeFileSync } from 'node:fs'

setupDomStub()
// Fast timers are safe here — local channel only, no fetch/WebSocket.
installFastTimers()

const { default: Game } = await import('../../public/js/game.js')
const { GameDriver } = await import('../../public/js/gameDriver.js')
const { createLocalPusher } = await import('../../public/js/localSession.js')
const { HarnessInput, randomStrategy } = await import('./harness-input.mjs')
const { Narrator } = await import('./narrator.mjs')

const N = parseInt(process.env.N || '3', 10)
const QTR = parseInt(process.env.QTR || '7', 10)
const TIMEOUT = parseInt(process.env.TIMEOUT || '60000', 10)
const OUT = process.env.OUT || ''

// Rotating matchups so the transcript covers different team ids.
// Indices into public/js/teams.js TEAMS list.
const MATCHUPS = [
  [0, 1],   // SF vs CHI
  [14, 15], // GB vs DAL? (indices depend on ordering — just visual variety)
  [8, 11]   // LAC vs COL?
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

  // Subscribe narrator BEFORE driver starts so we catch the first broadcast.
  const channel = pusher.subscribe()
  const narrator = new Narrator(channel)
  narrator.start()

  const driver = new GameDriver(game.run, game)

  const timeout = new Promise((_, reject) => {
    realSetTimeout(
      () => reject(new Error('timed out after ' + TIMEOUT + 'ms')),
      TIMEOUT
    )
  })

  try {
    await Promise.race([driver.run_(), timeout])
    const state = driver.state
    return {
      idx,
      ok: true,
      transcript: narrator.transcript(),
      stats: narrator.statsBlock(),
      finalState: state
    }
  } catch (err) {
    return {
      idx,
      ok: false,
      err: err.message || String(err),
      transcript: narrator.transcript(),
      stats: narrator.statsBlock(),
      finalState: driver.state
    }
  }
}

async function main () {
  const pieces = []
  pieces.push(
    `=========================================================`
  )
  pieces.push(
    `FBG narrative harness — N=${N} quarters=${QTR}min CPU vs CPU`
  )
  pieces.push(
    `=========================================================\n`
  )

  for (let i = 0; i < N; i++) {
    pieces.push(`\n╔════════════════════════════════════════╗`)
    pieces.push(`║  GAME ${i + 1}                                 ║`)
    pieces.push(`╚════════════════════════════════════════╝\n`)
    const r = await runOneGame(i)
    pieces.push(r.transcript)
    pieces.push('\n' + r.stats)
    if (!r.ok) pieces.push(`\n!!! GAME FAILED: ${r.err}`)
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
