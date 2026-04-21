# Session 4 — Collapse v5.1

## Why now

Every session since Phase 2 has added another patch to `public/js/run.js`
to keep its imperative flow coexisting with the server-authoritative
engine. We've hit a series of hangs / freezes / null-pick crashes, each
caused by a different v5.1 code path that assumed state it no longer
owns. The pattern is clear: we're patching the symptoms, not the
problem.

The problem is that **v5.1's Run class drives the game by awaiting DOM
animations and peer messages in an imperative chain**. The engine now
owns game logic. The two models don't compose cleanly — every
adjustment leaks.

Time to collapse.

## Target architecture

```
public/js/
├── script.js        — start screen, mode selection, route to driver
├── gameDriver.js    — NEW: the play loop (dispatches actions, hands events to animator)
├── session/
│   ├── online.js    — NEW: OnlineSession (WS → DO, typed dispatch)
│   └── local.js     — NEW: LocalSession (engine.reduce in-browser with seeded RNG)
├── ui.js            — NEW: UI adapter (getPlay, getCoinCall, getReceiveOrDefer, getPAT, ...)
├── animator.js      — already exists; walks events into DOM
├── buttonInput.js   — simplified: button rendering + click→Promise
├── onlineChannel.js — WS wrapper (kept)
├── engine.js        — bundled engine (kept)
├── graphics.js      — DOM helper primitives (kept, maybe trimmed)
└── defaults.js      — MODAL_MESSAGES constants only (constants for phases live in engine)
```

**Deletions (post-collapse):**
- `run.js` → most of it. The remaining shell (DOM element refs, alertBox) merges into `ui.js`.
- `engineRunner.js` — local engine path for v5.1 compatibility. Gone; LocalSession does it cleanly.
- `engineBridge.js` — only used by engineRunner.
- `remoteUtils.js` — peer RNG sync. Dead.
- `game.js`, `player.js`, `stat.js`, `play.js`, `site.js` — mutable v5.1 state containers. Replaced by engine's `GameState` which is read-only / event-driven.
- `baseInput.js`, `formInput.js`, `promptInput.js`, `textInput.js` — alternate input modes. Unused or replaced.
- `refactor.js`, `input.js`, any remaining `*.test.js` v5.1 stubs.

Net: **public/js/ shrinks from ~4,000 LoC to ~800 LoC.**

## The driver loop (pseudocode)

```js
export async function runGame(session, ui, animator, render) {
  await session.start()  // host: init + START_GAME; both: await initial state
  
  while (session.state.phase !== 'GAME_OVER') {
    const events = await driveOne(session, ui)
    await animator.apply(render, session.state, events)
  }
  
  await ui.gameOver(session.state)
}

async function driveOne(session, ui) {
  const s = session.state
  switch (s.phase) {
    case 'COIN_TOSS': {
      if (session.isCaller('away')) {
        const call = await ui.getCoinCall(s)
        return session.dispatch({ type: 'COIN_TOSS_CALL', player: s.field.offense === 1 ? 2 : 1, call })
      }
      return session.nextState()
    }
    case 'KICKOFF':
      if (session.isHost) {
        return session.dispatch({ type: 'RESOLVE_KICKOFF' })
      }
      return session.nextState()
    case 'REG_PLAY':
    case 'OT_PLAY': {
      const play = await ui.getPlay(s)
      if (play === 'FG' || play === 'PUNT') {
        return session.dispatch({ type: 'FOURTH_DOWN_CHOICE', player: session.me, choice: play.toLowerCase() })
      }
      return session.dispatch({ type: 'PICK_PLAY', player: session.me, play })
    }
    case 'PAT_CHOICE':
      if (session.me === s.field.offense) {
        const choice = await ui.getPatChoice(s)
        return session.dispatch({ type: 'PAT_CHOICE', player: session.me, choice })
      }
      return session.nextState()
    // ...
  }
}
```

No `Utils.randInt`. No `sendInputToRemote`. No `timeChanger`. Just: read phase → ask UI for input → dispatch → animate.

## Session interface

```js
// abstract — both sessions present this surface
class Session {
  state           // GameState
  me              // 1 | 2
  isHost          // boolean
  
  async start()                   // init + START_GAME
  async dispatch(action)          // returns {state, events} after resolution
  async nextState()               // await next broadcast (for non-dispatchers)
  isCaller(role)                  // me === the player in 'role' slot
}

// LocalSession — single-player
class LocalSession extends Session {
  #rng                            // seededRng
  #cpu                            // AI strategy for the non-local player
  async dispatch(action) {
    const r = engine.reduce(this.state, action, this.#rng)
    this.state = r.state
    return { state: this.state, events: r.events }
  }
}

// OnlineSession — multiplayer
class OnlineSession extends Session {
  #channel                        // OnlineChannel
  async dispatch(action) {
    this.#channel.dispatchAction(action)
    const { state, events } = await this.#awaitTerminalState()
    this.state = state
    return { state, events }
  }
}
```

## Rollout strategy

**Phase 4a (this session):** Write the new driver + OnlineSession + UI
adapter. Route online-multi through the new stack. Leave v5.1 paths in
place for single-player / local co-op. Harness already validates the
protocol; if the new driver talks to the DO correctly, we're golden.

**Phase 4b (next session):** Build LocalSession + CPU strategy. Route
single-player + local co-op through it. Delete `engineRunner.js`,
`engineBridge.js`, `remoteUtils.js`.

**Phase 4c (next session):** Shrink `run.js` to DOM helpers only. Move
those into `ui.js`. Delete `run.js`, `game.js`, `player.js`, `stat.js`,
`play.js`, `site.js`. Delete stale input modes.

**Phase 4d (sometime):** The animator gains FIELD_GOAL animation, punt
graphics, coin flip, die-roll visualizations. Right now these are
`alertBox` placeholders.

## Testing cadence

- **Engine tests:** unchanged, 143 passing, gate every deploy.
- **Harness:** validates the wire protocol. `N=50` after every
  non-trivial server change.
- **Browser smoke:** two tabs, host + remote, play a drive. After
  every UI or driver change.
- **Rejoin smoke:** start a game, refresh one tab, verify rejoin.
  Periodically.

## What we're NOT doing in Session 4

- Building new animations. The animator stays as-is; gaps get
  narrated via alerts for now.
- Changing the engine. All 143 tests keep passing; engine code
  shouldn't need edits.
- Mobile / responsive. Still Phase 6.
- Chat, accounts, share links. Phase 5.
- Custom domain. Phase 6.
