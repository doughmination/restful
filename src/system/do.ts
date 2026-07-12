/**
 * Copyright (c) 2026 Clove Twilight
 * Licensed under the ESAL-2.0 Licence.
 * See LICENCE.md in the project root for full licence information.
 */

/**
 * SystemState — the Durable Object that IS the old backend "process".
 *
 *  - Holds all persistent state (users, tags, statuses, battery, mental
 *    state) in DO key-value storage via a small Store adapter.
 *  - Owns the visitor-log SQLite table (DO embedded SQLite).
 *  - Is the WebSocket hub for /v2/plural/ws, using the hibernatable
 *    WebSocket API so idle sockets don't keep the DO billed/awake.
 *  - Delegates all HTTP to the Hono `systemApp`.
 *
 * A single instance is used (idFromName("system")), so the module-level
 * runtime set in the constructor is safe.
 */

import type { SystemEnv } from "./types";
import { setRuntime, type Store } from "./runtime";
import { systemApp } from "./app";

class DoStore implements Store {
  constructor(private storage: DurableObjectStorage) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const value = await this.storage.get<T>(key);
    return value ?? fallback;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.storage.put(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }
}

const WS_PATH = "/v2/plural/ws";

export class SystemState implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, env: SystemEnv) {
    this.state = state;
    setRuntime({
      env,
      store: new DoStore(state.storage),
      sql: state.storage.sql,
      broadcast: (data) => this.broadcast(data),
    });

    // Ping/pong keepalive without waking the DO from hibernation.
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === WS_PATH) {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }
      return this.handleWsUpgrade();
    }

    return systemApp.fetch(req, {} as never);
  }

  private handleWsUpgrade(): Response {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    // Hibernatable accept — the DO can be evicted while sockets stay open.
    this.state.acceptWebSocket(server);

    try {
      server.send(
        JSON.stringify({
          type: "connection_established",
          timestamp: new Date().toISOString(),
          message: "WebSocket connected successfully",
        }),
      );
    } catch {
      // ignore send failure on a just-opened socket
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- Hibernation WebSocket handlers -------------------------------------

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const data = typeof message === "string" ? message : "";
    if (data === "ping") {
      ws.send("pong");
    } else if (data === "subscribe") {
      ws.send(JSON.stringify({ type: "subscribed", timestamp: new Date().toISOString() }));
    }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    try {
      ws.close(code, "closing");
    } catch {
      // already closed
    }
  }

  webSocketError(): void {
    // no-op; the runtime cleans the socket up
  }

  /** Fan a JSON payload out to every connected client. */
  private broadcast(data: unknown): void {
    const message = JSON.stringify(data);
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch {
        // drop dead sockets silently
      }
    }
  }
}
