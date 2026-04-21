# Phase 3 — Online multiplayer

## Session 1 (done): WebSocket relay

v5.1's multiplayer was a message-passing system on top of Pusher. The
host generated random numbers and picks; the remote received them
through a private Pusher channel; every RNG pull, team selection, and
play call flowed through that channel.

Session 1 replaces Pusher with our own relay:

- **[server/multiplayer.mjs](../server/multiplayer.mjs)** — Express +
  `ws` WebSocket server. Each game is a room keyed by a 6-char code.
  `{ type: "create" }` opens a room, `{ type: "join", code }` attaches
  the second player, `{ type: "relay", payload }` broadcasts to the
  peer. That's the whole protocol.

- **[public/js/onlineChannel.js](../public/js/onlineChannel.js)** —
  client-side Pusher-compatible interface. Exposes
  `channel.trigger(event, data)` / `channel.bind(event, cb)` so
  [run.js](../public/js/run.js) works without code changes. `pusher`
  in [script.js](../public/js/script.js) now points at this instead of
  the Pusher SDK; the v5.1 multiplayer UI flow (host creates code,
  remote types it, game starts) is unchanged.

- Smoke-tested end-to-end:
  [server/multiplayer.smoke.mjs](../server/multiplayer.smoke.mjs)
  (`npm run test:multiplayer`). Opens two WebSockets, creates a room,
  joins, relays, verifies both directions.

### What works now

- `npm run dev` → local server on `:3000`, static + multiplayer.
- Host picks "Online" → gets a 6-char code.
- Remote pastes the code → both browsers are in the same room.
- Every v5.1 multiplayer flow runs unchanged (coin toss, team pick,
  RNG sync, plays). The engine resolves plays on each client;
  determinism + identical messages keep both clients in sync.

### What doesn't (yet)

- **Server authority.** The engine still runs in the browser. A
  tampered client could cheat. Session 2 moves `reduce()` onto the
  server — the relay becomes state-transition authority.
- **Persistence.** Games evaporate when both clients disconnect.
  Session 2 adds an action log so games can be resumed.
- **Public deploy.** Our relay needs a persistent server; Netlify
  serverless won't do. Fly.io / Render / Railway all work (see
  deploy note below).

## Deploy the relay publicly

Fly.io is the fastest path. One-time setup:

```bash
brew install flyctl        # or curl -L https://fly.io/install.sh | sh
fly auth signup            # or `fly auth login`
fly launch --no-deploy     # creates fly.toml; pick a name, region
fly deploy
```

The root [Dockerfile](../Dockerfile) (add if missing):

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server-local.js"]
```

Then in the Netlify-hosted client or wherever the frontend lives, set
the WebSocket origin to the Fly URL (or a custom domain pointed at it).
Out of the box [onlineChannel.js](../public/js/onlineChannel.js) uses
`location.host`, so same-origin deploy "just works" — or swap in a
hardcoded `ws://fbg-multiplayer.fly.dev/api/ws` if splitting.

## Session 2 — server-authoritative (TODO)

1. Move `@fbg/engine` onto the server: import in `multiplayer.mjs`,
   keep a `GameState` per room, apply `reduce()` on each client
   action.
2. Swap the client relay: instead of forwarding raw messages, server
   receives `Action` objects and broadcasts resulting `Event` arrays.
3. Postgres (or Supabase) for the action log. `(gameId, seq, action,
   state_snapshot)`.
4. Rewrite client to animate an event stream rather than compute
   locally (the "collapse" from [PHASE2.md](PHASE2.md#5-the-final-collapse--phase-3-territory)).

After session 2, FBG is cheat-proof online multiplayer with replay,
resume, and spectator mode as essentially free downstream features.
