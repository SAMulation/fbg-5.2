# Session 7 — Testing + Bug Squashing

## Why now

Session 4 collapsed ~3500 lines of v5.1 imperative flow into a
GameDriver that reads engine state and dispatches actions. The engine
has 143 unit tests + a protocol harness, but **neither covers the
driver itself**. Every bug so far has surfaced as "I played a game,
the game froze" — expensive to reproduce, expensive to diagnose.

Known bugs entering this session:

1. **Single-player PAT hang.** After a TD, phase transitions to
   `PAT_CHOICE` and the game freezes. Suspected cause: `cpuPages`
   short-circuits on a stale `currentPlay` from the previous play, or
   `fgAnimation` blocks on a CSS transition that never fires.
2. **Online-multi out-of-sync after ~2 plays.** Remote player picks a
   play, no broadcasts arrive. Suspected cause: drain loop consumes a
   stray `CLOCK_TICKED` broadcast and mis-interprets it as the
   opponent's `PLAY_CALLED`, or host hits a parallel animation hang.

## Goals

**Escalate from anecdotal manual testing to fast headless repros.**
Every bug class below should be catchable without loading a browser.

| Layer | What we trust | Coverage today | Gap |
|---|---|---|---|
| Engine | reduce(state, action, rng) | 143 unit tests | ✓ |
| Protocol | DO wire format | `@fbg/harness` N=50 random | ✓ |
| Driver | GameDriver + Session | — | **everything** |
| Wire + Driver together | two clients + real DO | — | **everything** |

## Plan

### Step 1 — Dev-shortcut URL `[~15 min]`

Add a `?dev=<mode>` query param that short-circuits the start screen:

- `?dev=single` — single-player, random teams, default options, auto-start
- `?dev=double` — local two-player
- `?dev=computer` — 0-player (CPU vs CPU)
- `?dev=host` — online host (creates code, waits)
- `?dev=remote&code=XXX` — online remote (joins)

Implementation: `script.js` checks `location.search` on load, if
`dev=` present, bypass `attachNextEvent` and call `submitGame` with
the right connectionType immediately.

### Step 2 — Toggleable verbose logging `[~10 min]`

A single `fbgLog(namespace, ...args)` helper with per-namespace gates:

```js
// public/js/log.js
const ENABLED = new Set((location.search.match(/log=([^&]+)/)?.[1] ?? '').split(','))
export const fbgLog = (ns, ...args) => {
  if (ENABLED.has('*') || ENABLED.has(ns)) console.log('[' + ns + ']', ...args)
}
```

Usage sites:
- `driver` — phase transitions, dispatches, awaited broadcasts
- `session` — state updates, broadcast queue
- `input` — pick received, pick dispatched
- `channel` — WS send / recv

URL: `?log=driver,input` or `?log=*`. Default: nothing logged. Leave
the existing `console.log` calls in place until we've ported them;
gradual migration.

### Step 3 — Headless local-game harness `[~1 session]`

`packages/harness/src/driver-local.mjs`:

```js
// Drives a full single-player game through GameDriver + LocalSession
// using a minimal DOM stub (enough that scoreChange / fgAnimation /
// animateResolution can run without throwing).

import { runLocalGame } from '../src/driver-harness.mjs'

await runLocalGame({
  team1: 'NE',
  team2: 'GB',
  seed: 42,
  strategy: 'random',     // or 'always_sr', 'aggressive', etc.
  qtrLength: 7,
  onPhase: (state, events) => {},  // optional hook for assertions
})
```

The DOM stub:
- `document.querySelector(...)` returns a proxied element whose
  `.classList.add/remove/toggle/contains`, `.innerText`,
  `.setAttribute`, `.addEventListener`, `.querySelector` are all
  stubs that record state.
- `transitionend` events fire synchronously on `classList` change so
  `animationWaitForCompletion` resolves immediately.
- `setTimeout` → immediate (or a scheduled microtask for sleeps).

The harness imports `GameDriver` + `createLocalPusher` directly and
runs them against the stub. Picks come from a pluggable strategy.

Success criteria: `N=100` games complete without a hang, all reach
`GAME_OVER` with consistent scores.

**This catches PAT hangs, animation hangs, driver deadlocks.**

### Step 4 — Dual-client online harness `[~1 session, deferred]`

Extend `@fbg/harness` to run two `OnlineSession`-wrapped driver
instances against a locally running worker. Picks from scripted
strategies. Catches wire-level sync bugs that only appear when both
clients interact through the DO.

Deferred to next session; Step 3 is the higher ROI first pass.

## Testing cadence

- **Every driver change**: `npm run harness:local N=100`
- **Every session end**: both harnesses at N=100
- **Known bugs**: add a scripted scenario (e.g., "play to TD, pick
  PAT") as a named test so regressions are caught by CI later

## Logging conventions

Prefer `fbgLog('driver', ...)` over `console.log` in new code. When
debugging online:
- Host: `?log=driver,channel`
- Remote: `?log=driver,channel`
- Worker: `wrangler tail` gives you DO-side logs for free

When debugging local:
- `?log=driver,input,session`

## What Session 7 is NOT

- Rewriting the animator for smoother transitions (that's part of
  Session 4d / later).
- Adding more engine features (the 5 `it.todo`s stay in their box).
- Mobile / responsive — Phase 6.
