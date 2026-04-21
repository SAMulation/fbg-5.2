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

## Known gaps

- **2-point conversion picks**: `TWO_PT_CONV` phase runs the same
  PICK_PLAY flow, but the engine's reducer doesn't yet route
  `TWO_PT_CONV` picks through `resolveTwoPointConversion`. Games that
  land in that phase may not score the 2pt correctly. Same gap the
  browser client has; fix lives in the engine reducer.
- **Clock**: host ticks 30 seconds per play. Real games might use
  different durations (penalty + timeout clock rules aren't modeled).
- **Timeouts**: no bot calls `CALL_TIMEOUT`.
