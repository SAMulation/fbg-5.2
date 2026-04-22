/**
 * FBG Worker — entry point.
 *
 * Routes:
 *   POST /api/games        -> { code }  (generate a new 6-char room code)
 *   GET  /api/ws?code=XYZ  -> WebSocket upgrade, routed to GameRoom(XYZ)
 *   *                      -> static assets
 *
 * Each game room is a single Durable Object instance, keyed by code.
 * Session 1: the DO is a dumb message relay between the two connected
 * clients (matches v5.1's Pusher behavior, just on our infra). Session 2
 * will host @fbg/engine inside the DO for server-authoritative play.
 */

export { GameRoom } from "./game-room.js";

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  RATE_LIMITER?: {
    limit(opts: { key: string }): Promise<{ success: boolean }>;
  };
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)] ?? "A";
  }
  return out;
}

function withCors(resp: Response): Response {
  const h = new Headers(resp.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  return new Response(resp.body, { status: resp.status, headers: h });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Preflight.
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    // Create a new game room: Worker picks a code, client opens WS to it.
    if (url.pathname === "/api/games" && request.method === "POST") {
      // Rate limit per client IP so a single actor can't spray
      // randomCode() calls to exhaust Durable Object storage. The binding
      // is optional at the type level — in tests / local dev without the
      // binding configured, we no-op and let the request through.
      if (env.RATE_LIMITER) {
        const ip = request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for") ??
          "unknown";
        const { success } = await env.RATE_LIMITER.limit({ key: `gamecreate:${ip}` });
        if (!success) {
          return withCors(
            new Response("too many game creation attempts; slow down", {
              status: 429,
              headers: { "retry-after": "60" },
            }),
          );
        }
      }
      const code = randomCode();
      return withCors(Response.json({ code }));
    }

    // WebSocket upgrade: route to the GameRoom DO keyed by ?code=.
    if (url.pathname === "/api/ws") {
      const upgrade = request.headers.get("Upgrade");
      if (upgrade !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      const code = (url.searchParams.get("code") ?? "").toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        return new Response("bad or missing ?code", { status: 400 });
      }
      const id = env.GAME_ROOM.idFromName(code);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    // Everything else: static client.
    return env.ASSETS.fetch(request);
  },
};
