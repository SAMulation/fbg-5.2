# Phase 2 — Wiring v5.1's frontend through `@fbg/engine`

## Status: **complete for rules**

Every football rule in FootBored now flows through `@fbg/engine`.
What remains in v5.1 is the DOM / animation / input / multiplayer
scaffolding — which is the intended state: the engine owns the math,
v5.1 owns the experience.

The "collapse" step from the earlier roadmap (replacing
`playMechanism` with a single `engine.reduce` call plus a pure
event-driven animator) is the natural Phase 3 kickoff: it requires
restructuring v5.1's imperative animation flow, which is a deeper
architectural change than a rule-by-rule port and is better done
alongside the Supabase server-authority work that motivated Phase 1
in the first place.

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
- **[public/js/game.js#decMults / decYards](../public/js/game.js)**
  pre-fetch indices via `Utils.randInt` (multiplayer sync), then replay
  them through `engine.drawMultiplier` / `drawYards` so the deck
  arithmetic is engine-owned.
- **[public/js/engineBridge.js](../public/js/engineBridge.js)** —
  `buildEngineState(game)`, `applyEngineStateToGame(game, state)`,
  `replayRng(values)`. The lift / lower / rng adapters that let
  resolvers delegate math while v5.1 drives the flow.
- **[public/js/run.js#hailMary](../public/js/run.js)** routes through
  `engine.resolveHailMary` for the die→outcome table. v5.1 still owns
  the DOM + `changePoss` calls.
- **[public/js/run.js#fieldGoal](../public/js/run.js)** routes through
  `engine.resolveFieldGoal` for the make/miss decision. Kicker icing
  is detected in v5.1 and passed via `{ iced: true }`.
- **[public/js/run.js#doPlay](../public/js/run.js)** — regular-play
  fast path: clean SR/LR/SP/LP non-matching picks call
  `engineRunner.resolveRegularViaEngine`, which runs the engine
  end-to-end for matchup → multiplier → yards → yardage and hands
  back a pre-baked outcome.
- **[public/js/run.js#samePlay / trickPlay / bigPlay](../public/js/run.js)**
  — rewritten as thin switches over `engine.samePlayOutcome`,
  `engine.trickPlayOutcome`, `engine.bigPlayOutcome`. v5.1 keeps the
  alerts / animations / possession-change calls; the rule tables are
  the engine's.
- **[public/js/run.js#punt](../public/js/run.js)** uses
  `engine.puntKickDistance` and `engine.puntReturnMultiplier` for
  the two deterministic pieces (kick formula + return multiplier
  table). The block / muff 2-sixes checks are so trivial they stay
  inline.

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

**Done:** `hailMary`, `fieldGoal`, `samePlay`, `trickPlay`, `bigPlay`,
`punt`, regular-play fast path.

The rule-tables-as-pure-helpers pattern (`samePlayOutcome`,
`trickPlayOutcome`, `bigPlayOutcome`, `puntReturnMultiplier`,
`puntKickDistance`) turned out to be the right call instead of the
earlier "pre-fetch RNG then replayRng" idea. v5.1's resolvers keep
their async flow / alerts / animations and just look up the rule
outcome from the engine. This was the piece the original roadmap
was missing.

### 5. The final collapse — Phase 3 territory

Replacing `playMechanism` ([run.js:1036](../public/js/run.js#L1036))
with a single `engine.reduce` + pure event-driven animator is the
natural kickoff for Phase 3 (Supabase server authority). It requires
restructuring v5.1's imperative animation flow, and pairs cleanly
with moving the engine to the server and driving the client from a
remote event stream.

```js
// Eventual shape — Phase 3:
const result = engine.reduce(this.engineState, action, rng)
this.engineState = result.state
await this._animate(result.events)
```

`_animate` walks the `events[]` array and plays the corresponding
DOM transitions. Once that exists, the `Game` / `Player` / `Run`
classes can be deleted and `script.js` holds only the engine
`GameState` plus button-click dispatch.

## Multiplayer story

v5.1's Pusher-based multiplayer is currently disabled (per recent
commits). Phase 3 (Supabase Edge Functions wrapping the same engine)
brings it back with server authority — the engine's seeded determinism
makes that straightforward.

Until then, single-player is the only mode that needs to work. This
simplifies Phase 2 dramatically: we don't need the async RNG wrapper
for multiplayer sync, so engine.drawMultiplier can be called directly.
