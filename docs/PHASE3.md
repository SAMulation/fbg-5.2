# Phase 3 — Online multiplayer via Cloudflare

## Architecture

```
Browser
  │
  │   HTTP  POST /api/games         ─► { code }
  │   WS    /api/ws?code=<code>     ─► game room
  │
  ▼
fbg-worker (Cloudflare Worker)
  │
  │  routes /api/games to itself
  │  routes /api/ws    to GameRoom DO  keyed by code
  │  everything else   to static assets (public/)
  │
  ▼
GameRoom (Durable Object, one per code)
  │
  │  tracks up to 2 WebSockets (host + remote)
  │  session 1: relays messages between them
  │  session 2: runs engine.reduce() authoritatively (scaffolding in place)
```

## Session 1 (done): Worker + Durable Object with relay protocol

- **[packages/worker/src/index.ts](../packages/worker/src/index.ts)** —
  entry. `POST /api/games` returns a new 6-char code. `GET /api/ws?code=X`
  upgrades to a WebSocket routed to the `GameRoom` DO for that code.
  Everything else is served from `public/` via the `ASSETS` binding.
- **[packages/worker/src/game-room.ts](../packages/worker/src/game-room.ts)** —
  the Durable Object. Uses Cloudflare's WebSocket Hibernation API
  (`state.acceptWebSocket` + `webSocketMessage`/`webSocketClose`
  handlers) so the DO can hibernate between messages. First connection
  is `host`, second is `remote`; third is 409. Session 1 relays
  `{ type: "relay", payload }` verbatim. Session 2 scaffolding:
  `{ type: "action", action }` hook that will run `engine.reduce`.
- **[public/js/onlineChannel.js](../public/js/onlineChannel.js)** —
  client. POSTs `/api/games` for a code, opens a WebSocket, presents a
  Pusher-compatible surface so v5.1's `run.js` works unchanged.
- **Smoke test:** `packages/worker/smoke.mjs` — opens two WS clients,
  relays both directions. Passes against local `wrangler dev`.

### Local dev

```bash
npm run dev
```

Runs `wrangler dev` from `packages/worker/`. The Worker serves both the
static client AND the multiplayer WS on `http://localhost:8787`. Open
two browser tabs:

1. Tab 1 → Online multiplayer → Host. Shows a 6-char code.
2. Tab 2 → Online multiplayer → Remote. Paste the code.
3. Play.

Static-only iteration (no multiplayer, no Worker):

```bash
npm run dev:static
```

### Deploy

One-time setup:
```bash
cd packages/worker
npx wrangler login              # opens browser, auth Cloudflare
npx wrangler deploy             # pushes Worker + DO
```

Wrangler deploys to `fbg-worker.YOUR-SUBDOMAIN.workers.dev`. Hook up a
custom domain (e.g. `footbored.com`) in the Cloudflare dashboard.

After first deploy, subsequent `git push` → `npm run deploy` from CI
(or local) ships in ~10s. Free tier easily covers low-volume play.

## Session 2 step 1 (done): DO is engine-authoritative

- [`game-room.ts`](../packages/worker/src/game-room.ts) imports
  `@fbg/engine` and holds the canonical `GameState` per room.
- Protocol:
  - `C -> S  { type: "init", setup: { team1, team2, quarterLengthMinutes } }`
  - `C -> S  { type: "action", action }` — `Action` from `@fbg/engine`
  - `S -> C  { type: "state", state, events }` — broadcast post-reduce
  - Legacy `{ type: "relay", payload }` still forwarded so v5.1 client works
- Per-game seed + full action log persisted to DO storage. Games are
  replayable from `(seed, actions[])`.
- Smoke test: [`smoke-authority.mjs`](../packages/worker/smoke-authority.mjs)
  drives INIT + START_GAME + COIN_TOSS_CALL, asserts both clients
  receive identical state. Passes.

## Session 2 step 2 (next): client rewire

The DO is now waiting to serve actions. The remaining work is on the
browser side.

**Goal**: for online multiplayer only (single-player / local co-op
keep using the client-side engine path as-is), replace v5.1's
handshake + peer-to-peer RNG with server-authoritative dispatch.

**Concrete tasks**:

1. **Setup phase**. Replace the v5.1 handshake (`ping` → `pong` →
   team exchange → config exchange in [run.js lines 220-250](../public/js/run.js#L220-L250))
   with a pair of `{ type: "setup" }` messages from each side, then
   one side sends `{ type: "init", setup }` to the DO. DO assembles
   state, broadcasts. Both clients receive state, populate their
   local `Game` object.

2. **Play dispatch**. In [run.js `doPlay`](../public/js/run.js),
   when multiplayer, send `{ type: "action", action: { type: "PICK_PLAY", player, play } }`
   instead of calling `engineRunner.resolveRegularViaEngine`. Wait
   for the DO's `state` broadcast. Apply the engine `GameState` back
   to `game.thisPlay` / `game.spot` / etc via
   [`engineBridge.applyEngineStateToGame`](../public/js/engineBridge.js).

3. **Other dispatches**. `COIN_TOSS_CALL`, `RECEIVE_CHOICE`,
   `PAT_CHOICE`, `FOURTH_DOWN_CHOICE`, `CALL_TIMEOUT`,
   `RESOLVE_KICKOFF`, `TICK_CLOCK` — wrap each existing UI handler
   so that in multiplayer mode it sends an action rather than
   running locally.

4. **Delete dead RNG**. Once online multiplayer is fully action-driven,
   `remoteUtils.js`'s multiplayer RNG sync (and v5.1's
   `sendInputToRemote`/`receiveInputFromRemote`) is no longer called.
   `engineRunner.js` and `engineBridge.js` stop being needed for
   online play (still used for single-player).

5. **Event animator (stretch)**. Walk the `events[]` from each
   broadcast and play the matching animation. This is the true
   "collapse" from [PHASE2.md](PHASE2.md#5-the-final-collapse--phase-3-territory).
   Can be deferred — step 2 above still works by applying state and
   letting v5.1's animations run from state deltas.

After step 2, FBG online multiplayer is fully server-authoritative.
Cheat-proof, replayable, and friends-across-the-world works with
the same feel as v5.1.
