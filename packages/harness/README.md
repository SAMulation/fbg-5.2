# @fbg/harness

Headless end-to-end harness for FBG multiplayer. Spawns pairs of bot
clients that play real games through the Cloudflare Worker + Durable
Object using the same protocol as the browser client.

## Why

Manually opening two browser tabs, picking teams, and playing through
30 seconds of clock drain to exercise a single code path is a slog.
The harness runs N games in parallel in under a second and produces
JSON reports showing every event that happened — perfect for
regression-catching, balance-tuning, and sanity-checking new engine
rules.

## Prerequisites

The Worker has to be running somewhere the harness can hit.

```bash
# terminal 1
npm run dev   # wrangler dev on :8787
```

## Running

```bash
# terminal 2
npm run harness                                           # 10 games, random vs random
N=50 npm run harness                                      # 50 games
HOST_STRAT=aggressive REMOTE_STRAT=conservative npm run harness
WORKER=https://fbg-worker.x.workers.dev npm run harness   # against deployed Worker
VERBOSE=1 N=1 npm run harness                             # step-by-step trace for debugging
```

Exit status is 0 iff every game reached GAME_OVER *and* both clients'
final scores agreed. Any divergence = the DO broadcast either didn't
reach both clients or was applied differently, which is a bug.

## Strategies

Three built-in — extend [strategies.mjs](strategies.mjs) for more.

- **random** — uniformly picks from legal in-hand plays; coin flips
  random.
- **aggressive** — prefers LP/LR, takes 4th & long with LP, FG from
  their opponent's 40, HM inside 2 minutes, 2pt if trailing.
- **conservative** — SR-heavy, kicks FG from midfield, punts
  otherwise, always PAT kick.

## Report format

Stdout gets a JSON blob:

```json
{
  "config": { "games": 10, "hostStrategy": "random", ... },
  "totals": {
    "completed": 10,
    "errored": 0,
    "divergent": 0,
    "totalDurationMs": 329,
    "avgActionsPerGame": 193
  },
  "eventTotals": {
    "TOUCHDOWN": 67,
    "FIELD_GOAL_GOOD": 8,
    "TURNOVER": 24,
    ...
  },
  "games": [
    {
      "gameId": 1,
      "code": "B9FLR2",
      "teams": { "1": "NE", "2": "GB" },
      "winner": 1,
      "scores": { "1": 27, "2": 14 },
      "finalQuarter": 5,
      "actions": 182,
      "eventHistogram": { ... }
    },
    ...
  ]
}
```

Pipe through `jq` to filter / summarize:

```bash
N=100 npm run harness | jq '.totals'
N=100 npm run harness | jq '.games[] | select(.error != null)'
N=100 npm run harness | jq '[.games[].winner] | group_by(.) | map({winner: .[0], count: length})'
```

## Architecture

- **[client.mjs](client.mjs)** — `HeadlessClient` class. Opens WS,
  speaks the protocol, holds a reference to the DO's canonical
  GameState (via `state` broadcasts), dispatches actions based on
  current phase.
- **[strategies.mjs](strategies.mjs)** — decision functions
  (`pickPlay`, `coinCall`, `receiveOrDefer`, `patChoice`). Each
  strategy is a plain object the client consults at decision points.
- **[game.mjs](game.mjs)** — `runGame({hostStrategy, remoteStrategy})`
  spawns a host + remote pair against a fresh DO room and plays to
  completion.
- **[run.mjs](run.mjs)** — CLI entry. Parses env vars, runs N games
  with `Promise.all`, emits the JSON summary.

## Local CPU-vs-CPU drivers (no Worker required)

Three additional drivers run entirely in-process against the local
engine bundle — no Worker, no network. They share the LocalChannel
session layer (`public/js/localSession.js`) so they exercise the same
reducer the browser does.

```bash
# Single CPU vs CPU game with full play-by-play transcript
N=1 QTR=7 node driver-narrative.mjs

# N-seed statistical audit — fails non-zero on any invariant violation,
# any timeout, or any band drift (mean score, pass:rush, turnovers, etc).
npm run audit                # N=50 QTR=3 — quick regression check
npm run audit:smoke          # N=10 QTR=3 — fastest sanity check
npm run audit:full           # N=200 QTR=7 — overnight thorough
```

### Determinism — `SEED` env

Both drivers honor `SEED=<int>` to make the run byte-deterministic:

```bash
SEED=42 N=1 QTR=3 node driver-narrative.mjs    # always the same game
SEED=42 N=1 QTR=3 node driver-narrative.mjs    # diff exits 0
```

`installSeededRandom` replaces `Math.random` with Mulberry32 and
`installFakeNow` pins `Date.now`, which together fully determinize the
v5.1 CPU AI + LocalChannel's seedBase.

### Action-log replay

Every game (or every flagged seed in `audit`) dumps a self-contained
JSON bundle to `/tmp/fbg-action-logs/`:

```json
{
  "seedBase": 1700000000042,
  "setup": { "team1": "SF", "team2": "CHI", "quarterLengthMinutes": 3 },
  "actions": [{ "type": "START_GAME", ... }, ...],
  "finalState": { "phase": "GAME_OVER", ... }
}
```

Replay any bundle through the engine reducer directly (no driver, no AI):

```bash
npm run replay /tmp/fbg-action-logs/seed-7.json
# → "replay OK — 73 actions, byte-equal final state"
# or → "replay DIVERGED" with a per-key diff if engine semantics changed
```

This is what makes flagged seeds reproducible bugs: ship the JSON,
replay reproduces exactly, fix the engine, replay byte-equal again.

## Known gaps

- **2-point conversion picks**: `TWO_PT_CONV` phase runs the same
  PICK_PLAY flow, but the engine's reducer doesn't yet route
  `TWO_PT_CONV` picks through `resolveTwoPointConversion`. Games that
  land in that phase may not score the 2pt correctly. Same gap the
  browser client has; fix lives in the engine reducer.
- **Clock**: host ticks 30 seconds per play. Real games might use
  different durations (penalty + timeout clock rules aren't modeled).
- **Timeouts**: no bot calls `CALL_TIMEOUT`.
