/**
 * GameRoom Durable Object — server-authoritative FBG room.
 *
 * The canonical GameState lives here. Clients send actions; the DO runs
 * `engine.reduce` and broadcasts the new state + events to everyone in
 * the room. Random numbers come from a seeded RNG whose seed is
 * persisted with the state, so the game is fully replayable from the
 * action log.
 *
 * Protocol:
 *   S -> C  { type: "welcome", role: "host" | "remote" }
 *   S -> C  { type: "peer-joined" }              sent to host on 2nd connect
 *   S -> C  { type: "peer-disconnected" }
 *
 *   Legacy relay (still supported so v5.1 client works during the
 *   rewire):
 *     C -> S  { type: "relay", payload }
 *     S -> C  { type: "relay", payload }
 *
 *   Server-authoritative (new):
 *     C -> S  { type: "init",   setup: {...} }   start a game
 *     C -> S  { type: "action", action }         dispatch
 *     S -> C  { type: "state",  state, events }  broadcast new state
 *     S -> C  { type: "error",  reason }
 */

import {
  reduce,
  initialState,
  seededRng,
  type Action,
  type Event as GameEvent,
  type GameState,
} from "@fbg/engine";

type Role = "host" | "remote";

interface WsMeta {
  role: Role;
}

interface PersistedGame {
  state: GameState;
  seed: number;
  /** Append-only log of actions applied, for replay / audit. */
  actions: Action[];
}

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  private meta = new WeakMap<WebSocket, WsMeta>();

  // Authoritative game state — hydrated lazily from storage.
  private game: PersistedGame | null = null;
  private gameLoaded = false;

  constructor(state: DurableObjectState) {
    this.state = state;

    for (const ws of state.getWebSockets()) {
      const attached = ws.deserializeAttachment() as WsMeta | null;
      if (attached) this.meta.set(ws, attached);
    }

    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<PersistedGame>("game");
      if (stored) this.game = stored;
      this.gameLoaded = true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get("Upgrade");
    if (upgrade !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const existing = this.state.getWebSockets();
    if (existing.length >= 2) {
      return new Response("room full", { status: 409 });
    }

    const role: Role = existing.length === 0 ? "host" : "remote";
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    const meta: WsMeta = { role };
    server.serializeAttachment(meta);
    this.meta.set(server, meta);

    server.send(JSON.stringify({ type: "welcome", role }));

    // Catch a newly-connected client up on current state if a game is
    // already in progress. This is the server-side of reconnect / rejoin:
    // if a player refreshes the tab (or joins late on another device),
    // they receive the canonical state immediately and can resume.
    if (this.game) {
      server.send(JSON.stringify({
        type: "state",
        state: this.game.state,
        events: [],
      }));
    }

    if (role === "remote") {
      this.broadcastExcept(server, { type: "peer-joined" });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.gameLoaded) {
      // blockConcurrencyWhile in constructor should guarantee this, but
      // defensive: wait a tick if somehow hit.
      await new Promise((r) => setTimeout(r, 0));
    }

    let msg: unknown;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const m = msg as {
      type?: string;
      payload?: unknown;
      action?: Action;
      setup?: InitSetup;
    };

    if (m.type === "relay") {
      this.broadcastExcept(ws, { type: "relay", payload: m.payload });
      return;
    }

    if (m.type === "init") {
      await this.handleInit(ws, m.setup);
      return;
    }

    if (m.type === "action" && m.action) {
      await this.handleAction(ws, m.action);
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.meta.delete(ws);
    this.broadcastExcept(ws, { type: "peer-disconnected" });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.meta.delete(ws);
    this.broadcastExcept(ws, { type: "peer-disconnected" });
  }

  // ---------- server-authoritative handlers ----------

  private async handleInit(ws: WebSocket, setup: InitSetup | undefined): Promise<void> {
    if (!setup || typeof setup !== "object") {
      this.sendError(ws, "init: missing setup");
      return;
    }
    if (this.game) {
      // Game already in flight — return current state instead of erroring.
      ws.send(JSON.stringify({ type: "state", state: this.game.state, events: [] }));
      return;
    }

    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const state = initialState({
      team1: { id: String(setup.team1 ?? "?") },
      team2: { id: String(setup.team2 ?? "?") },
      quarterLengthMinutes: Number(setup.quarterLengthMinutes ?? 7),
    });

    this.game = { state, seed, actions: [] };
    await this.state.storage.put("game", this.game);

    this.broadcast({ type: "state", state, events: [] });
  }

  private async handleAction(ws: WebSocket, action: Action): Promise<void> {
    if (!this.game) {
      this.sendError(ws, "action before init");
      return;
    }

    // The seeded RNG is reconstructed per-reduce from the base seed plus the
    // action index, so each action draws from a different deterministic
    // stream while the WHOLE game remains replayable from (seed, actions).
    const rng = seededRng((this.game.seed + this.game.actions.length) >>> 0);

    let result;
    try {
      result = reduce(this.game.state, action, rng);
    } catch (err) {
      this.sendError(ws, "reduce threw: " + (err as Error).message);
      return;
    }

    this.game.state = result.state;
    this.game.actions.push(action);
    await this.state.storage.put("game", this.game);

    this.broadcast({ type: "state", state: result.state, events: result.events });
  }

  // ---------- helpers ----------

  private sendError(ws: WebSocket, reason: string): void {
    try {
      ws.send(JSON.stringify({ type: "error", reason }));
    } catch {}
  }

  private broadcast(msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(data); } catch {}
    }
  }

  private broadcastExcept(origin: WebSocket, msg: unknown): void {
    const data = JSON.stringify(msg);
    for (const ws of this.state.getWebSockets()) {
      if (ws === origin) continue;
      try { ws.send(data); } catch {}
    }
  }
}

interface InitSetup {
  team1: string;
  team2: string;
  quarterLengthMinutes?: number;
}

// Re-export engine types for the client bundle — handy for typing the
// protocol on the client side once the v5.1 rewire happens next session.
export type { Action, GameEvent, GameState };
