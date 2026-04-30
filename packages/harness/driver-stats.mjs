/**
 * Statistical-audit harness — runs N seeded games and reports aggregate
 * gameplay statistics. The point is to surface regressions in distribution
 * (FG completion rate, average score, turnovers per game, plays per game,
 * etc.) the moment they drift, even if no single game throws an
 * invariant violation.
 *
 * Usage:
 *   N=50 node driver-stats.mjs           # 50 games, seeds 1..50
 *   N=200 SEED_START=1000 node driver-stats.mjs
 *   QTR=7 N=20 node driver-stats.mjs     # full 7-min quarters
 *
 * Each game is run deterministically (Math.random + Date.now seeded), so
 * a flagged seed can be reproduced exactly with
 *   SEED=<seed> node driver-narrative.mjs
 */

import { setupDomStub, installFastTimers, installSeededRandom, installFakeNow, realSetTimeout, realClearTimeout } from './dom-stub.mjs'

setupDomStub()
installFastTimers()

const { default: Game } = await import('../../public/js/game.js')
const { GameDriver } = await import('../../public/js/gameDriver.js')
const { createLocalPusher } = await import('../../public/js/localSession.js')
const { HarnessInput, randomStrategy } = await import('./harness-input.mjs')
const { InvariantChecker } = await import('./invariants.mjs')

const N = parseInt(process.env.N || '50', 10)
const QTR = parseInt(process.env.QTR || '3', 10)
const SEED_START = parseInt(process.env.SEED_START || '1', 10)
const TIMEOUT = parseInt(process.env.TIMEOUT || '180000', 10)

const MATCHUPS = [[0, 1], [14, 15], [8, 11]]

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

async function runOneGame (seed, idx) {
  installSeededRandom(seed)
  installFakeNow()

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

  const channel = pusher.subscribe()
  const invariants = new InvariantChecker(channel)
  invariants.start()

  // Capture final state by tapping the same broadcast.
  let lastState = null
  channel.bind('server-state', ({ state }) => { lastState = state })

  const driver = new GameDriver(game.run, game)

  let timeoutHandle = null
  const timeout = new Promise((_, reject) => {
    timeoutHandle = realSetTimeout(
      () => reject(new Error('timed out after ' + TIMEOUT + 'ms')),
      TIMEOUT
    )
  })

  try {
    await Promise.race([driver.run_(), timeout])
    if (timeoutHandle) realClearTimeout(timeoutHandle)
    return { seed, ok: true, state: lastState, violations: invariants.violations }
  } catch (err) {
    if (timeoutHandle) realClearTimeout(timeoutHandle)
    return {
      seed,
      ok: false,
      err: err.message || String(err),
      state: lastState,
      violations: invariants.violations
    }
  }
}

function pct (counts, total) {
  return total === 0 ? '—' : (100 * counts / total).toFixed(1) + '%'
}

function mean (xs) {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length
}

function median (xs) {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

async function main () {
  console.log(`FBG stats harness — N=${N} games, QTR=${QTR}min, seeds ${SEED_START}..${SEED_START + N - 1}`)
  const results = []
  const startMs = Date.now ? Date.now() : 0
  void startMs

  for (let i = 0; i < N; i++) {
    const seed = SEED_START + i
    const r = await runOneGame(seed, i)
    results.push(r)
    process.stderr.write(r.ok ? '.' : 'F')
    if (r.violations.length) process.stderr.write('!')
  }
  process.stderr.write('\n')

  // Aggregate.
  const ok = results.filter(r => r.ok && r.state)
  const failed = results.filter(r => !r.ok)
  const flagged = results.filter(r => r.violations.length > 0)

  const scores1 = ok.map(r => r.state.players[1].score)
  const scores2 = ok.map(r => r.state.players[2].score)
  const totalPts = ok.map(r => r.state.players[1].score + r.state.players[2].score)
  const passYards = ok.flatMap(r => [r.state.players[1].stats.passYards, r.state.players[2].stats.passYards])
  const rushYards = ok.flatMap(r => [r.state.players[1].stats.rushYards, r.state.players[2].stats.rushYards])
  const turnovers = ok.flatMap(r => [r.state.players[1].stats.turnovers, r.state.players[2].stats.turnovers])
  const sacks = ok.flatMap(r => [r.state.players[1].stats.sacks, r.state.players[2].stats.sacks])

  console.log('')
  console.log('=== Run summary ===')
  console.log(`  Games completed:         ${ok.length} / ${N}`)
  console.log(`  Games failed (timeout):  ${failed.length}`)
  console.log(`  Games with violations:   ${flagged.length}`)
  if (failed.length) {
    console.log('  Failed seeds:', failed.map(r => r.seed).join(', '))
  }
  if (flagged.length) {
    console.log('  Flagged seeds (with violation kinds):')
    for (const r of flagged) {
      const kinds = [...new Set(r.violations.map(v => v.msg))]
      console.log(`    SEED=${r.seed}: ${kinds.join('; ')}`)
    }
  }

  // Statistical bands — assert distributions stay in plausible ranges so
  // a regression in scoring/balance/turnover-rate fails the audit even
  // when no single game throws an invariant. Bounds are loose initial
  // guesses; tighten as we collect baseline data.
  const BANDS = []
  const outOfBand = []
  if (ok.length) {
    const meanScore = mean([...scores1, ...scores2])
    const meanTotal = mean(totalPts)
    const passRush = mean(passYards) / Math.max(1, mean(rushYards))
    const meanTurnovers = mean(turnovers)
    const meanSacks = mean(sacks)
    const shutouts = ok.filter(r => r.state.players[1].score === 0 || r.state.players[2].score === 0).length
    const shutoutPct = 100 * shutouts / ok.length

    BANDS.push(['mean per-team score', meanScore, 5, 40])
    BANDS.push(['mean total / game', meanTotal, 12, 80])
    BANDS.push(['pass:rush ratio', passRush, 0.5, 3.5])
    BANDS.push(['turnovers / team-game', meanTurnovers, 0.1, 2.5])
    BANDS.push(['sacks / team-game', meanSacks, 0.0, 2.0])
    BANDS.push(['shutout pct', shutoutPct, 0, 50])

    console.log('')
    console.log('=== Score distribution ===')
    console.log(`  Mean total / game:       ${meanTotal.toFixed(1)}`)
    console.log(`  Median total / game:     ${median(totalPts)}`)
    console.log(`  Mean per-team score:     ${meanScore.toFixed(1)}`)
    console.log(`  Shutouts:                ${shutouts} (${pct(shutouts, ok.length)})`)

    console.log('')
    console.log('=== Per-team stats (avg per game) ===')
    console.log(`  Pass yards:              ${mean(passYards).toFixed(1)}`)
    console.log(`  Rush yards:              ${mean(rushYards).toFixed(1)}`)
    console.log(`  Pass:Rush ratio:         ${passRush.toFixed(2)}`)
    console.log(`  Turnovers:               ${meanTurnovers.toFixed(2)}`)
    console.log(`  Sacks:                   ${meanSacks.toFixed(2)}`)

    for (const [name, value, lo, hi] of BANDS) {
      if (value < lo || value > hi) {
        outOfBand.push(`${name} = ${value.toFixed(2)} outside [${lo}, ${hi}]`)
      }
    }

    console.log('')
    console.log('=== Statistical bands ===')
    if (outOfBand.length === 0) {
      console.log(`  All ${BANDS.length} bands in range.`)
    } else {
      for (const msg of outOfBand) console.log(`  OUT: ${msg}`)
    }
  }

  // Hard-fail loudly if any invariants tripped, any seed timed out, or
  // any statistical band drifted out of range — `npm run audit` should
  // exit non-zero so CI can flag regressions.
  if (flagged.length > 0 || failed.length > 0 || outOfBand.length > 0) {
    console.error(`\n!!! ${flagged.length} flagged + ${failed.length} failed seed(s) + ${outOfBand.length} band(s) out`)
    process.exit(1)
  }
}

main().catch((e) => { console.error(e); process.exit(2) })
