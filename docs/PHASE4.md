# Phase 4 — The Road From "Deployed" to "The Game I Loved"

You are here: live multiplayer at
[fbg-worker.gentle-dust-4a98.workers.dev](https://fbg-worker.gentle-dust-4a98.workers.dev),
CI set up (`git push origin main` ships to prod). Engine has 143
passing tests. Bots play real games through the Durable Object in
parallel via [`@fbg/harness`](../packages/harness/README.md).

From here, six sessions get us to polished, shareable, cheat-proof
online FBG.

```
┌─────────────────────────────────────────────────────────────────┐
│  YOU ARE HERE                                                    │
│  Live at workers.dev, auto-deploy on push, engine solid,        │
│  plays resolve server-authoritative, but animations are        │
│  currently alert-box placeholders in online mode.               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
```

---

## Session 1 — Event-driven animator `[~2 sessions]`

**The one thing a user will notice first.** Online plays currently
narrate via `alertBox` because v5.1's `reportPlay` pipeline was
tripping on assumptions that don't hold when state comes from the
server. Fix: write a new module that consumes the engine's
`events[]` stream and plays the v5.1 DOM animations in order.

### Rough shape
- `public/js/animator.js` exports `animate(run, events, state)`.
- Each `events[]` entry maps to a DOM transition:
  - `PLAY_CALLED` → flip plCard1 / plCard2 with the pick
  - `PLAY_RESOLVED` → reveal quality band + multiplier card +
    yards card
  - `FIRST_DOWN` / `TURNOVER_ON_DOWNS` → down-marker update, ball
    move
  - `TOUCHDOWN` / `SAFETY` → v5.1's existing scoreChange animation
  - etc.
- Replaces `_narratePlayResolution` and the `reportPlay` bypass.

### Why now
The rest of the roadmap (engine gaps, reconnect, collapse)
benefits from having a clean animator path already in place. And
the "feel" regression from v5.1 is the #1 perceptible difference
to the user.

### Testing
- In browser: play through a full drive; card reveals + ball
  movement + score bump should look identical to v5.1 single-player.
- `@fbg/harness` doesn't change — it only cares about protocol, not
  animations.

---

## Session 2 — Close the engine gaps `[~1 session]`

Three items the harness already flags or that we documented as
deferred:

### 2a. `TWO_PT_CONV` routing in the reducer
When `PICK_PLAY` fires in `TWO_PT_CONV` phase, route through
`resolveTwoPointConversion` instead of `resolveRegularPlay`. Scoring
+2 happens only if the ball crosses the goal line. Phase transitions
to `KICKOFF` afterward.

### 2b. Server-side `TICK_CLOCK`
Client currently runs v5.1's `timeChanger` locally. Replace with
`TICK_CLOCK` dispatched to the DO after each play. Server becomes
authoritative for quarter-end, halftime, regulation-end, OT-entry.
Removes clock drift.

### 2c. `CALL_TIMEOUT` over the wire
Add a "call timeout" button. Client dispatches `CALL_TIMEOUT`. Server
decrements timeouts, broadcasts state. v5.1 already has the UI
affordances; we just need to wire the action path.

### 2d. Overtime end-to-end
The harness enters OT on a tie but we haven't smoke-tested a full
overtime game through the server. Run it, fix whatever breaks.

### Testing
- Engine: add / un-skip tests for each item (the 5 `it.todo`s).
- Harness: `N=200 npm run harness` — assert overtime reached when
  scores tied, GAME_OVER always set, converged scores.

---

## Session 3 — Reconnect + session durability `[~1 session]`

Closing a tab mid-game loses everything today. Fix so you can reopen
a tab, rejoin by code, and pick up where the DO left off.

### Shape
- Client stashes `{gameCode, role, me}` in `localStorage` on setup.
- On load, if stash present and `gameCode` is still alive on the
  server, reconnect; server re-broadcasts current state + replays
  recent events.
- DO exposes `GET /api/games/:code/state` for the rehydration read
  (already has `state.storage.get("game")` to back it).

### Testing
- Start a game, score a TD, close the tab, reopen. Game should
  resume with scoreboard, spot, phase all intact.

---

## Session 4 — Collapse v5.1 `[~2 sessions]`

Now that every mechanic flows through the engine and animations are
event-driven, v5.1's local compute path is dead weight. Delete:

- `public/js/engineRunner.js` — local-engine-for-single-player. Route
  single-player through the same path as online (the DO is fine for
  one-client games).
- `public/js/engineBridge.js` — only useful while v5.1 Game coexisted
  with engineState.
- `public/js/remoteUtils.js` + sendInput/receiveInput + inbox — dead.
- `Game` class → thin wrapper over `engineState` (or delete entirely).
- `Run` class → animator + input dispatcher.
- Most of the 3000-line `run.js` — the coin toss, kickoff, play,
  endPlay functions duplicate what the engine + animator already do.

**Acceptance**: `public/js/` code size drops by ~50%. Every function
is server-auth-aware or pure DOM/input glue.

### Testing
- Full-game regression via browser (single-player + multiplayer).
- `N=500 npm run harness` — protocol layer hasn't changed.

---

## Session 5 — Social layer `[~2 sessions]`

Make it a game people can actually share.

### Scope
- **Identity**: anonymous account (nickname + persistent device
  ID via `localStorage`). No signup flow for now.
- **Share link**: `fbg-worker.gentle-dust-4a98.workers.dev/?join=XYZ`
  auto-opens join flow with the code prefilled.
- **Chat channel**: a `chat` relay message type for in-game banter.
  Not a giant feature — 1 input, 1 message list.
- **Recent games** (stretch): Workers KV or D1 stores last N games
  per device. "Rematch" button on the main screen.

### Testing
- Two devices, real internet, share the URL. Verify chat arrives,
  game state syncs, rematch works.

---

## Session 6 — Polish `[~0.5 session]`

- **Custom domain**: `footbored.com` → Cloudflare dashboard adds the
  CNAME + SSL. No code change.
- **Mobile responsive**: the UI is desktop-first. Squish it.
- **Copy pass**: placeholder text ("PHI 21", "1st & 10" in the
  scoreboard) → real dynamic values from state.
- **Meta / OG image**: shareable link should render nicely in iMessage
  / Discord / Slack.

### Testing
- Test link share: iMessage preview, Discord embed, open on phone.

---

## Recommended order

```
Session 1: animator     → restores the feel, unblocks iteration
Session 2: engine gaps  → correctness rounds off
Session 3: reconnect    → "I can actually play a whole game"
Session 4: collapse     → codebase fits in a head again
Session 5: social       → shareable
Session 6: polish       → polished
```

Each session ends with something testable + a commit to `main`
(which auto-deploys).

## Testing cadence

- **Per commit**: GitHub Action → engine tests → deploy. ~30s.
- **Before end-of-session**: `N=50 npm run harness` against
  `localhost:8787`. ~2s.
- **Before sharing a URL**: `N=20 WORKER=<prod-url> npm run harness`.
  ~10s. Confirms prod is clean.
