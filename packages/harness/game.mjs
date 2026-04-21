/**
 * Single game: spawn host + remote HeadlessClients, wire them through a
 * Worker instance, play to completion, return a combined report.
 */

import { HeadlessClient } from './client.mjs'

const DEFAULT_TEAMS = [
  { abrv: 'NE', name: 'Patriots' },
  { abrv: 'GB', name: 'Packers' },
  { abrv: 'DAL', name: 'Cowboys' },
  { abrv: 'PHI', name: 'Eagles' },
  { abrv: 'KC', name: 'Chiefs' },
  { abrv: 'SF', name: '49ers' }
]

function pickTeamPair () {
  const a = DEFAULT_TEAMS[Math.floor(Math.random() * DEFAULT_TEAMS.length)]
  let b = DEFAULT_TEAMS[Math.floor(Math.random() * DEFAULT_TEAMS.length)]
  while (b.abrv === a.abrv) b = DEFAULT_TEAMS[Math.floor(Math.random() * DEFAULT_TEAMS.length)]
  return [a, b]
}

export async function runGame ({
  httpBase,
  wsBase,
  hostStrategy,
  remoteStrategy,
  qtrLengthMinutes = 7,
  gameId,
  log = () => {}
}) {
  // 1. Ask the Worker for a fresh game code.
  const res = await fetch(`${httpBase}/api/games`, { method: 'POST' })
  if (!res.ok) throw new Error(`POST /api/games failed: ${res.status}`)
  const { code } = await res.json()

  const [teamA, teamB] = pickTeamPair()

  const host = new HeadlessClient({
    httpBase, wsBase, code, role: 'host', team: teamA,
    strategy: hostStrategy, qtrLengthMinutes,
    log: (m) => log(`[game ${gameId} host] ${m}`)
  })
  const remote = new HeadlessClient({
    httpBase, wsBase, code, role: 'remote', team: teamB,
    strategy: remoteStrategy, qtrLengthMinutes,
    log: (m) => log(`[game ${gameId} remote] ${m}`)
  })

  const started = Date.now()
  let error = null
  try {
    // Connect in order: host first so the DO is created, then remote joins.
    await host.connect()
    await remote.connect()
    await host.waitForPeer() // remote's welcome is already received

    // Setup runs on both sides concurrently (exchange relays in parallel).
    await Promise.all([host.setup(), remote.setup()])

    // Play in parallel too — each side drives its own dispatch cadence.
    const [hostReport, remoteReport] = await Promise.all([host.play(), remote.play()])

    return {
      gameId,
      code,
      teams: { 1: teamA.abrv, 2: teamB.abrv },
      strategies: { host: hostStrategy.name, remote: remoteStrategy.name },
      host: hostReport,
      remote: remoteReport,
      durationMs: Date.now() - started,
      error: null,
      converged: hostReport.scores[1] === remoteReport.scores[1] &&
                 hostReport.scores[2] === remoteReport.scores[2]
    }
  } catch (err) {
    error = err
    return {
      gameId,
      code,
      teams: { 1: teamA.abrv, 2: teamB.abrv },
      strategies: { host: hostStrategy.name, remote: remoteStrategy.name },
      host: null,
      remote: null,
      durationMs: Date.now() - started,
      error: error.message,
      converged: null
    }
  } finally {
    host.close()
    remote.close()
  }
}
