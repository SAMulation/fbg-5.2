# @fbg/engine

The pure FootBored game engine. **No DOM. No network. No timers. No animations.**

Just football rules expressed as a single function:

```ts
reduce(state: GameState, action: Action, rng: Rng): { state: GameState; events: Event[] }
```

## Why this exists

Every previous version of FBG mixed game rules with UI, network, and animation. That made the rules untestable and the codebase fragile. This package exists so the rules can be:

1. **Tested exhaustively.** Every mechanic (matchup, Hail Mary die, Same Play coin, OT alternation, two-minute warning) becomes a unit test. The tests are the spec — once written, the mechanics cannot be lost.
2. **Run anywhere.** Browser (single-player), Supabase Edge Function (authoritative server), Node (CLI replay tool). The engine doesn't know or care.
3. **Audited deterministically.** Given the same `(state, action, rngSeed)`, the engine always produces the same `(newState, events)`. This is what makes server-authoritative multiplayer possible: server runs the engine, broadcasts events, clients apply events to mirror state.

## What's in here vs. what's NOT

**In here:**
- `GameState` — full football state (down, distance, score, clocks, possession, hands of cards, OT period)
- `Action` — discrete inputs (`PICK_PLAY`, `CALL_TIMEOUT`, `KICK_FG`, `ACCEPT_PENALTY`, …)
- `Event` — discrete outputs (`PLAY_RESOLVED`, `TOUCHDOWN`, `CLOCK_TICKED`, `TURNOVER`, …)
- `Rng` — pluggable random source (seeded for tests, server-supplied for prod)
- `reduce()` — pure transition function

**NOT in here:**
- DOM, CSS, animations, sound
- WebSocket / Pusher / Supabase clients
- Player input UI
- CPU AI (lives in a separate `@fbg/ai` package eventually — but consumes the same engine)
- Persistence (the consumer serializes `GameState` however it wants)

## Architecture

```
Client UI              Server (Supabase Edge Function)
   │                          │
   │  PICK_PLAY action        │
   │ ───────────────────────► │
   │                          │   reduce(state, action, rng)
   │                          │   ─────────────────────────►
   │                          │   ◄───────────────────────── { state, events }
   │                          │
   │  events broadcast        │   persist state to Postgres
   │ ◄─────────────────────── │
   │                          │
   │  apply events → render   │
   │  (animation, sound, UX)  │
```

The server is the only authority on state. Clients send intents and render events. This kills the cheating vector that v5.1 has (all logic client-side).

## Status

Skeleton sketched. The `MATCHUP` and `MULTI` matrices are ported and tested. Next: port `yardage` calculation, then start porting `playMechanism` from [public/js/run.js](../../public/js/run.js) action by action.
