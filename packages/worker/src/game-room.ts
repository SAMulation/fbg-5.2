/**
 * GameRoom Durable Object — one per FBG game code.
 *
 * Session 1 behavior: dumb relay between the two connected WebSockets.
 * First client to connect is the host; second is the remote. Messages
 * from one are forwarded verbatim to the other (matching v5.1's
 * Pusher message-passing flow).
 *
 * Session 2 seed (already scaffolded): the DO keeps GameState in
 * storage and can run engine.reduce() against it. Not wired to the
 * client protocol yet — the scaffolding is here so layering server
 * authority on top is a protocol change, not an infrastructure change.
 */

import type { GameState, Action, Event as GameEvent } from "@fbg/engine";

type Role = "host" | "remote";

interface WsMeta {
  role: Role;
}

export class GameRoom implements DurableObject {
  private state: DurableObjectState;
  // Mirror of state.getWebSockets() with attached metadata. The metadata
  // also lives in WebSocket.serializeAttachment so it survives hibernation.
  private meta = new WeakMap<WebSocket, WsMeta>();

  // Session 2 scaffolding. Not authoritative yet.
  private engineState: GameState | null = null;

  constructor(state: DurableObjectState) {
    this.state = state;

    // Restore metadata for any WebSockets that survived hibernation.
    for (const ws of state.getWebSockets()) {
      const attached = ws.deserializeAttachment() as WsMeta | null;
      if (attached) this.meta.set(ws, attached);
    }

    // Restore engineState if it was persisted.
    state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get<GameState>("engineState");
      if (stored) this.engineState = stored;
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

    // Hibernation-mode: the DO framework routes messages/close to our
    // webSocketMessage / webSocketClose handlers without keeping the DO
    // in memory between events.
    this.state.acceptWebSocket(server);
    const meta: WsMeta = { role };
    server.serializeAttachment(meta);
    this.meta.set(server, meta);

    // Inform this client of its role (host = first in, remote = second).
    server.send(JSON.stringify({ type: "welcome", role }));

    // If this is the second connection, notify the host.
    if (role === "remote") {
      this.broadcastExcept(server, { type: "peer-joined" });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    const m = msg as { type?: string; payload?: unknown; action?: Action };

    if (m.type === "relay") {
      // Session 1: forward payload verbatim to the peer.
      this.broadcastExcept(ws, { type: "relay", payload: m.payload });
      return;
    }

    if (m.type === "action" && m.action) {
      // Session 2: run the action through the engine, broadcast events.
      // Not yet: the client still sends relay messages. Scaffolding only.
      const events = await this.applyAction(m.action);
      this.broadcast({ type: "events", events });
      return;
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.meta.delete(ws);
    this.broadcastExcept(ws, { type: "peer-disconnected" });
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.meta.delete(ws);
    this.broadcastExcept(ws, { type: "peer-disconnected" });
  }

  // ---------- session 2 scaffolding ----------

  private async applyAction(_action: Action): Promise<GameEvent[]> {
    // TODO (session 2): load engine.reduce, apply, persist, return events.
    // For now: no-op so the message doesn't error. When the client side
    // switches to `{ type: "action" }` messages, this will be the only
    // file that needs a real body.
    return [];
  }

  // ---------- helpers ----------

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
