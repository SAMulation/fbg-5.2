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

## Session 2 (next): Server authority

The scaffolding for server-authoritative play is already in
[`game-room.ts`](../packages/worker/src/game-room.ts):

- `engineState: GameState | null` — mirror of the room's engine state,
  persisted via `state.storage`.
- `applyAction(action)` stub — will load `@fbg/engine`, call
  `reduce(engineState, action, rng)`, persist, broadcast events.
- New `{ type: "action" }` message type handled; client just doesn't
  send it yet.

To flip the switch:

1. Implement `applyAction` in the DO: import `reduce` / `initialState` /
   `seededRng` from `@fbg/engine`, hold the canonical `GameState`, run
   actions through it.
2. Rewrite [`public/js/run.js`](../public/js/run.js)'s play flow as an
   event-driven animator. Instead of computing locally via
   `engineRunner.js`, send `{ type: "action" }` messages and animate
   the returned `events` array. This is the "collapse" noted in
   [PHASE2.md](PHASE2.md#5-the-final-collapse--phase-3-territory).
3. Add an action log to DO storage so games can be resumed and
   replayed.
4. Delete `engineRunner.js` / `engineBridge.js` / the `Game`/`Run`/
   `Player` classes. The client becomes a thin event consumer.

After session 2, FBG is cheat-proof online multiplayer with replay,
resume, and spectator mode as downstream freebies.
