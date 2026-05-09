# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

FootBored ("FBG") — a digital boardgame version of American football. Three packages plus a static client:

- `packages/engine/` — pure TypeScript rules engine. No DOM, no network, no I/O. Single function: `reduce(state, action, rng) → { state, events }`. Vitest tests in `src/__tests__/`. The engine is the spec.
- `packages/worker/` — Cloudflare Worker + Durable Object (`GameRoom`) for server-authoritative multiplayer. Serves `public/` via the assets binding so the WS URL is same-origin (`/api/ws`). `game-room.ts` imports `@fbg/engine` and runs `reduce` server-side; `src/index.ts` still describes the DO as a message relay, but the engine path is wired in — the docstring is mid-migration and lags reality.
- `packages/harness/` — Node test harness with five entry points (see below).
- `public/` — the static browser client (`index.html` + `js/`). Plus `public/js/engine.js`, the **bundled engine** that `localSession.js` imports.
- `RULES.md` — canonical football + FBG rule checklist with stable IDs (`R-NN`, `F-NN`). Audit protocol lives at the bottom. Bugs land here first.
- `docs/` — phase/session notes, mostly historical.

## Architecture (the part that's not obvious from the file tree)

**There is one play loop, not two.** `public/js/gameDriver.js` is **THE** driver for every mode (single, double, computer, online). It speaks to a channel abstraction:
- `localSession.js` (LocalChannel) — runs `engine.reduce` directly in the browser. Used for single / double / computer modes.
- `onlineChannel.js` — sends actions over WS to the Worker DO, which runs `engine.reduce` server-side and broadcasts events. Used for host / remote / computer-host / computer-remote modes.

`script.js` picks the channel based on `site.connectionType`. Both channels expose the same surface, so `gameDriver.js` doesn't branch on transport. The legacy v5.1 functions (`gameLoop`, `endPlay`, `timeChanger`, `pickPlay`, `doPlay`, `calcDist`, `reportPlay`, `playMechanism`, `gameControl` in `run.js`) are explicitly **not used** by the new driver — gameDriver's header calls this out. Some helper exports from `run.js` are still imported (e.g. `setModalMessage`), so `run.js` isn't pure dead weight, but the driver path no longer flows through it.

**The bundled engine is generated, not edited.** `public/js/engine.js` is the esbuild bundle of `packages/engine/src/index.ts`. Always edit `packages/engine/src/**` and rerun `npm run test:engine` (which bundles via `posttest`) or `npm run build:engine` directly. Editing the bundle by hand will be silently overwritten. (See auto-memory `project_engine_build.md`.)

**The harness runs the real browser client in Node.** `dom-stub.mjs` provides a chained-proxy DOM (`document`, `window`, classList, styles, events, transitionend firing synchronously) so `gameDriver.js`, `run.js`, `animator.js`, and `graphics.js` load and execute unmodified. `installFastTimers` short-circuits sleeps; `installSeededRandom` + `installFakeNow` make runs byte-deterministic. This is what lets a harness audit catch real client bugs, not just engine bugs.

**RULES.md is load-bearing.** Every rule has a stable ID (`R-NN`, `F-NN`). Audit reports cite by ID. When you find a new bug:
1. Add an entry in RULES.md (`F-NN` for FBG-specific, `R-NN` for real football) with transcript evidence.
2. If it can be checked mechanically, promote it to `packages/harness/invariants.mjs`.
3. Mark `(FIXED YYYY-MM-DD)` with file:line of the fix once it lands.

**Harness completion ≠ correctness.** A green harness only proves no deadlock and no invariant violation. Real correctness requires narrated playthroughs walked against RULES.md, or the statistical bands in `driver-stats.mjs`. (See auto-memory `feedback_testing_correctness.md`.)

**Action-log replay is the bug-shipping format.** `driver-stats.mjs` dumps every flagged game to `/tmp/fbg-action-logs/seed-N.json` with `seedBase`, `setup`, `actions[]`, `finalState`. `npm run replay <bundle>` reproduces byte-equally; if it diverges, engine semantics changed.

## Commands

Engine:
- `npm run test:engine` — vitest run (cd `packages/engine`). `posttest` rebuilds `public/js/engine.js`. **Skipping this means the bundle drifts.**
- `npm run build:engine` — esbuild bundle → `public/js/engine.js` (sourcemap inline).
- `npm run build:engine:types` — `tsc` to `dist/`.
- Single test: `cd packages/engine && npx vitest run src/__tests__/<name>.test.ts` or `npx vitest run -t '<test name pattern>'`.

Dev / deploy:
- `npm run dev` — builds engine, then `wrangler dev` on :8787 with worker + DO + static assets. Use for multiplayer.
- `npm run dev:static` — express on :3000 serving `public/` only. Quick UI iteration; no multiplayer.
- `npm run deploy` — `wrangler deploy` (account pinned in `wrangler.toml`).

Root tests (legacy):
- `npm test` — Jest watch mode. Mostly old `*.test.js` next to `public/js/`. Engine work uses vitest. `.babelrc` exists for these.

Harness — five distinct entry points, each catches different bugs:

| Mode | Command | Catches |
| --- | --- | --- |
| WS-protocol harness | `npm run harness` | Worker / DO broadcast bugs. `HeadlessClient` speaks WS only — no GameDriver, no DOM. Requires `npm run dev` running. |
| Online dual-client | `cd packages/harness && WORKER=http://localhost:8787 node driver-online.mjs` | GameDriver sync bugs between two real clients. Uses DOM stub. Requires Worker running. |
| Local single-process | `cd packages/harness && node driver-local.mjs` (env `MODE=single\|double`) | GameDriver deadlocks in single/double/computer modes. No Worker. |
| Narrative | `cd packages/harness && SEED=42 N=1 QTR=3 node driver-narrative.mjs` | Manual correctness audit. Emits human-readable play-by-play. |
| Statistical | `npm run audit` (50/3) / `npm run audit:smoke` (10/3) / `npm run audit:full` (200/7) | Regression detection via bands (FG rate, avg score, turnovers, etc). Fails non-zero on invariant violation, timeout, or band drift. Dumps flagged seeds to `/tmp/fbg-action-logs/`. |

Replay:
- `npm run replay /tmp/fbg-action-logs/seed-N.json` — feeds the action log straight through `engine.reduce`. No driver, no AI. Diverges loudly if engine semantics changed.

`SEED=<int>` makes `driver-narrative.mjs` and `driver-stats.mjs` byte-deterministic via Mulberry32 + pinned `Date.now`.

## Engine internals

**Public surface** is `packages/engine/src/index.ts`. Consumers import only from there.

**Module layout:**
- `reducer.ts` — the `reduce` function and the action → resolver dispatch.
- `state.ts` — `initialState`, fresh deck builders, helpers like `opp`.
- `rules/` — pure resolver functions: `play.ts`, `matchup.ts`, `yardage.ts`, `deck.ts`, `overtime.ts`, and `specials/` (bigPlay, fieldGoal, hailMary, kickoff, punt, samePlay, trickPlay, twoPoint).
- `rules/specials/outcomes.ts` — outcome-roll tables isolated so they can be tested without going through `reduce()`.
- `validate.ts` — phase-transition validator. F-26..F-33 in RULES.md mirror what this enforces.
- `__tests__/` — one test file per mechanic. Tests are the spec.

**Imports use `.js` extensions** in source (`from "./rules/play.js"`) — TS NodeNext / ESM resolution. Don't strip them.

**v5.1 reference recovery.** When porting or verifying a special-play resolver, recover the pre-collapse source: `git show 9f43a3d^:public/js/run.js`. (See auto-memory `project_v51_source.md`.)
