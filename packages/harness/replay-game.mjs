/**
 * Replay a captured action log through the engine reducer directly,
 * skipping the driver and AI layers. Asserts byte-equal final state
 * against the recorded run.
 *
 * Usage:
 *   node replay-game.mjs /tmp/fbg-action-logs/7.json
 *
 * The JSON shape is what driver-narrative / driver-stats writes:
 *   { seedBase, setup: { team1, team2, quarterLengthMinutes },
 *     actions: [...], finalState: {...} }
 *
 * Exit codes:
 *   0 — replay produced byte-equal finalState
 *   1 — diverged (and the diff is printed)
 *   2 — file read / parse error
 */

import { readFileSync } from 'node:fs'

const { reduce, initialState, seededRng } = await import('../../public/js/engine.js')

const path = process.argv[2]
if (!path) {
  console.error('usage: node replay-game.mjs <action-log.json>')
  process.exit(2)
}

let bundle
try {
  bundle = JSON.parse(readFileSync(path, 'utf8'))
} catch (err) {
  console.error(`failed to read ${path}: ${err.message}`)
  process.exit(2)
}

const { seedBase, setup, actions, finalState } = bundle

let state = initialState({
  team1: { id: setup.team1 },
  team2: { id: setup.team2 },
  quarterLengthMinutes: setup.quarterLengthMinutes
})

for (let i = 0; i < actions.length; i++) {
  const rng = seededRng((seedBase + i) >>> 0)
  try {
    const result = reduce(state, actions[i], rng)
    state = result.state
  } catch (err) {
    console.error(`step ${i} (${actions[i].type}) threw: ${err.message}`)
    process.exit(1)
  }
}

const replayed = JSON.stringify(state)
const recorded = JSON.stringify(finalState)
if (replayed === recorded) {
  console.log(`replay OK — ${actions.length} actions, byte-equal final state`)
  process.exit(0)
}

console.error(`replay DIVERGED — ${actions.length} actions`)
console.error('--- recorded final phase:', finalState.phase, 'score:', finalState.players[1].score, '-', finalState.players[2].score)
console.error('--- replayed final phase:', state.phase, 'score:', state.players[1].score, '-', state.players[2].score)
// Best-effort field-by-field diff for the loud-but-not-too-loud case.
for (const key of Object.keys(finalState)) {
  const a = JSON.stringify(finalState[key])
  const b = JSON.stringify(state[key])
  if (a !== b) {
    console.error(`  ${key}: recorded=${a.slice(0, 200)}`)
    console.error(`  ${key}: replayed=${b.slice(0, 200)}`)
  }
}
process.exit(1)
