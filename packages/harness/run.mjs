/**
 * Parallel harness runner.
 *
 *   node run.mjs                                 # default: 10 games, random vs random, http://localhost:8787
 *   N=20 node run.mjs                            # 20 games
 *   HOST_STRAT=aggressive REMOTE_STRAT=conservative node run.mjs
 *   WORKER=https://fbg-worker.x.workers.dev node run.mjs   # against deployed Worker
 *   VERBOSE=1 node run.mjs                       # per-game line logs
 *
 * Exits 0 iff every game reported `gameOver: true` and both clients
 * agreed on final scores (convergence). Emits a JSON summary on stdout.
 */

import { runGame } from './game.mjs'
import { ALL_STRATEGIES } from './strategies.mjs'

const HTTP = process.env.WORKER || 'http://localhost:8787'
const WS = HTTP.replace(/^http/, 'ws')
const N = parseInt(process.env.N || '10', 10)
const HOST_STRAT_NAME = process.env.HOST_STRAT || 'random'
const REMOTE_STRAT_NAME = process.env.REMOTE_STRAT || 'random'
const VERBOSE = process.env.VERBOSE === '1'

const hostStrategy = ALL_STRATEGIES[HOST_STRAT_NAME]
const remoteStrategy = ALL_STRATEGIES[REMOTE_STRAT_NAME]
if (!hostStrategy) throw new Error('unknown host strategy: ' + HOST_STRAT_NAME)
if (!remoteStrategy) throw new Error('unknown remote strategy: ' + REMOTE_STRAT_NAME)

function log (m) { if (VERBOSE) console.error(m) }

async function main () {
  console.error(`[harness] ${N} games | ${HOST_STRAT_NAME} vs ${REMOTE_STRAT_NAME} | ${HTTP}`)
  const started = Date.now()

  const games = await Promise.all(
    Array.from({ length: N }, (_, i) => runGame({
      httpBase: HTTP,
      wsBase: WS,
      hostStrategy,
      remoteStrategy,
      gameId: i + 1,
      log
    }))
  )

  const totalMs = Date.now() - started

  // Aggregate summary.
  const completed = games.filter((g) => g.host && g.host.gameOver).length
  const errored = games.filter((g) => g.error).length
  const divergent = games.filter((g) => g.host && g.remote && !g.converged).length
  const avgActions = games
    .filter((g) => g.host)
    .reduce((s, g) => s + g.host.actionsDispatched + g.remote.actionsDispatched, 0) /
    Math.max(1, games.filter((g) => g.host).length)

  // Event histogram across all completed games.
  const eventTotals = {}
  for (const g of games) {
    if (!g.host) continue
    for (const [evt, count] of Object.entries(g.host.eventHistogram)) {
      eventTotals[evt] = (eventTotals[evt] || 0) + count
    }
  }

  const summary = {
    config: {
      games: N,
      hostStrategy: HOST_STRAT_NAME,
      remoteStrategy: REMOTE_STRAT_NAME,
      worker: HTTP
    },
    totals: {
      completed,
      errored,
      divergent,
      totalDurationMs: totalMs,
      avgActionsPerGame: Math.round(avgActions)
    },
    eventTotals,
    games: games.map((g) => ({
      gameId: g.gameId,
      code: g.code,
      teams: g.teams,
      strategies: g.strategies,
      durationMs: g.durationMs,
      error: g.error,
      converged: g.converged,
      winner: g.host?.winner ?? null,
      finalPhase: g.host?.finalPhase ?? null,
      finalQuarter: g.host?.finalQuarter ?? null,
      secondsRemaining: g.host?.secondsRemaining ?? null,
      scores: g.host?.scores ?? null,
      actions: g.host ? (g.host.actionsDispatched + g.remote.actionsDispatched) : null,
      eventHistogram: g.host?.eventHistogram ?? null
    }))
  }

  console.log(JSON.stringify(summary, null, 2))

  if (errored > 0 || divergent > 0 || completed !== N) {
    console.error(`[harness] ❌ ${errored} errored / ${divergent} divergent / ${N - completed} unfinished`)
    process.exit(1)
  }
  console.error(`[harness] ✅ ${completed}/${N} games completed, converged, ${totalMs}ms`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[harness] fatal:', err)
  process.exit(2)
})
