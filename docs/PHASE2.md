# Phase 2 — Wiring v5.1's frontend through `@fbg/engine`

## Goal

Replace v5.1's game-logic code with calls into the pure engine while
preserving the existing graphics, animations, and (deprecated)
multiplayer scaffold. By the end of Phase 2, [public/js/run.js](../public/js/run.js)
should be DOM/animation glue only — every piece of football math comes
from `@fbg/engine`.

## Build pipeline

The engine ships to the browser as a single ESM bundle:

```
packages/engine/  (source, TypeScript)
       │
       │  npm run build:browser  (esbuild)
       ▼
public/js/engine.js   (bundled, ESM, inline source map)
```

Browser modules import from `./engine.js` directly. No bundler at serve
time — the file is committed.

## What's done

- **[public/js/run.js#calcTimes](../public/js/run.js)** routes through
  `engine.matchupQuality` and `engine.MULTI`. The MATCHUP/MULTI
  duplicates in [defaults.js](../public/js/defaults.js) are removed.
- **[public/js/game.js#fillMults / fillYards](../public/js/game.js)**
  use `engine.freshDeckMultipliers` and `engine.freshDeckYards`.

## What's next, in order of value

### 1. Shadow-engine validation (recommended first)

For each play in v5.1's `playMechanism`, also feed the same action +
RNG into the engine's `reduce()`. After resolution, assert the
engine's `GameState` matches v5.1's `Game`. Any divergence becomes a
console warning + telemetry event.

**Why first:** It surfaces porting bugs immediately, with no risk to
the playable game. It's also the foundation for a confident cutover
later — you only delete v5.1 code once shadow-engine has run a
thousand games clean.

Files: new `public/js/shadow-engine.js`, hooks in `run.js`'s play
flow.

### 2. Deck draws via engine (medium effort)

Replace `game.decMults` / `game.decYards` in [game.js](../public/js/game.js)
with engine `drawMultiplier` / `drawYards`. The current async wrapper
exists for multiplayer RNG sync — the engine path stays sync, with
a thin pre-fetcher pattern:

```js
async decMultsViaEngine(p = null) {
  // Pre-fetch random indices async (multiplayer-safe).
  const indices = []
  while (true) {
    const i = await Utils.randInt(0, 3, this, p)
    indices.push(i)
    if (this.mults[i]) break
  }
  // Replay through pure engine.
  const fakeRng = { intBetween: () => indices.shift() ?? 0,
                    coinFlip: () => 'heads',
                    d6: () => 1 }
  const result = engine.drawMultiplier(
    { multipliers: this.mults, yards: this.yards },
    fakeRng,
  )
  this.mults = result.deck.multipliers
  return { card: result.card, num: result.index + 1 }
}
```

### 3. Status constants from engine

The `phase` field in engine `GameState` overlaps with v5.1's `status`
constants in [defaults.js](../public/js/defaults.js) (`INIT`,
`KICKOFF`, `REG`, `OFF_TP`, `FG`, `PUNT`, etc). Pick a unified naming
and migrate one file at a time.

### 4. Replace special-play resolvers one at a time

`run.hailMary`, `run.fieldGoal`, `run.bigPlay`, etc each have an
engine equivalent. Order from simplest to most-coupled:

1. `hailMary` (no card draws, just a die roll)
2. `bigPlay` (ditto)
3. `fieldGoal`
4. `samePlay`
5. `trickPlay` (offensive then defensive)
6. `punt`

Each replacement is a separate commit. The animation code stays in
run.js; only the math/state-mutation calls swap.

### 5. Delete `playMechanism` itself

Once every special play is engine-backed, the giant `playMechanism`
function ([run.js:1036](../public/js/run.js#L1036)) becomes a thin
dispatcher. At that point, replace it with a single call:

```js
const result = engine.reduce(this.engineState, action, rng)
this.engineState = result.state
await this._animate(result.events)
```

`_animate` is a new function that walks the `events[]` array and
plays the corresponding DOM transitions. This is where the v5.1
graphics live forever.

### 6. Drop the `Game`/`Player`/`Run` classes

Final form: `public/js/script.js` holds an engine `GameState`,
imports `engine.reduce`, and dispatches actions from button clicks.
Animations are pure event consumers. The old class-based architecture
is gone.

## Multiplayer story

v5.1's Pusher-based multiplayer is currently disabled (per recent
commits). Phase 3 (Supabase Edge Functions wrapping the same engine)
brings it back with server authority — the engine's seeded determinism
makes that straightforward.

Until then, single-player is the only mode that needs to work. This
simplifies Phase 2 dramatically: we don't need the async RNG wrapper
for multiplayer sync, so engine.drawMultiplier can be called directly.
