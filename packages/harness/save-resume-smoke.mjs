/**
 * Save/resume smoke test.
 *
 * Drives a few actions through a LocalChannel, calls save(), opens a fresh
 * channel, hydrates from the bundle, and asserts the post-hydrate state is
 * byte-equal to the post-save state. Also smokes the localStorage helpers.
 *
 * Usage:
 *   cd packages/harness && node save-resume-smoke.mjs
 */

import { setupDomStub, installSeededRandom, installFakeNow } from './dom-stub.mjs'

setupDomStub()
installSeededRandom(42)
installFakeNow()

const { default: LocalChannelModule } = await import('../../public/js/localSession.js')
  .then((m) => ({ default: m }))

// LocalChannel itself is not exported; createLocalPusher() exposes it indirectly.
// Re-implement enough scaffolding to exercise save/hydrate directly.
const localSession = await import('../../public/js/localSession.js')

const pusher = localSession.createLocalPusher()
await pusher.createGame()
const channel = pusher.subscribe()

await new Promise((resolve) => setTimeout(resolve, 5)) // let subscribe ack flush

channel.sendInit({ team1: 'NE', team2: 'GB', quarterLengthMinutes: 7 })
await channel.nextState()

const ACTIONS = [
  { type: 'START_GAME', quarterLengthMinutes: 7, teams: { 1: 'NE', 2: 'GB' } },
  { type: 'COIN_TOSS_CALL', player: 1, call: 'heads' },
  { type: 'RECEIVE_CHOICE', player: 1, choice: 'receive' },
  { type: 'RESOLVE_KICKOFF', kickType: 'RK', returnType: 'RR' },
  { type: 'PICK_PLAY', player: 1, play: 'LR' },
  { type: 'PICK_PLAY', player: 2, play: 'SR' },
  { type: 'TICK_CLOCK', seconds: 30 }
]

for (const action of ACTIONS) {
  channel.dispatchAction(action)
  await channel.nextState()
}

const stateBeforeSave = channel.state
const bundle = channel.save()

if (bundle.version !== 1) throw new Error('save bundle version wrong')
if (bundle.actionLog.length !== ACTIONS.length) {
  throw new Error(`actionLog length wrong: ${bundle.actionLog.length} vs ${ACTIONS.length}`)
}
if (JSON.stringify(bundle.stateSnapshot) !== JSON.stringify(stateBeforeSave)) {
  throw new Error('stateSnapshot diverges from current state')
}

// Hydrate a fresh channel from the bundle and verify state matches.
const pusher2 = localSession.createLocalPusher()
await pusher2.createGame()
const channel2 = pusher2.subscribe()
await new Promise((resolve) => setTimeout(resolve, 5))

channel2.hydrate(bundle)

if (JSON.stringify(channel2.state) !== JSON.stringify(stateBeforeSave)) {
  console.error('--- expected ---')
  console.error(JSON.stringify(stateBeforeSave, null, 2).slice(0, 500))
  console.error('--- got ---')
  console.error(JSON.stringify(channel2.state, null, 2).slice(0, 500))
  throw new Error('hydrated state diverges from pre-save state')
}

console.log(`✅ save/resume smoke passed — ${ACTIONS.length} actions, byte-equal post-hydrate`)

// Smoke localStorage round-trip.
channel.saveToStorage()
const reloaded = (await import('../../public/js/localSession.js')).createLocalPusher
// Use static method via a fresh subscribe.
const pusher3 = localSession.createLocalPusher()
const channel3 = pusher3.subscribe()
await new Promise((resolve) => setTimeout(resolve, 5))
const bundleFromStorage = window.fbgHasSave() && JSON.parse(window.localStorage.getItem('fbg.savedGame.v1'))
if (!bundleFromStorage) throw new Error('localStorage roundtrip failed: no bundle')
channel3.hydrate(bundleFromStorage)
if (JSON.stringify(channel3.state) !== JSON.stringify(stateBeforeSave)) {
  throw new Error('localStorage hydrate diverges from pre-save state')
}

console.log('✅ localStorage round-trip passed')
process.exit(0)
