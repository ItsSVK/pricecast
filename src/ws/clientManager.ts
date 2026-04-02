import type WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { createLogger } from "../core/logger.ts";

const log = createLogger("client-manager");

// Owns the registry of live WebSocket connections.
// The only place that holds ws references — broadcaster and server both delegate here.
export class ClientManager {
  private readonly clients = new Map<string, WebSocket>();

  register(ws: WebSocket): string {
    const id = uuidv4();
    this.clients.set(id, ws);
    log.info("Client connected", { id, total: this.clients.size });

    ws.on("close", () => this.unregister(id, "close"));
    ws.on("error", (err) => {
      log.error("Client socket error", { id, error: err.message });
      this.unregister(id, "error");
    });

    return id;
  }

  private unregister(id: string, reason: string): void {
    if (this.clients.delete(id)) {
      log.info("Client disconnected", { id, reason, total: this.clients.size });
    }
  }

  broadcast(data: string): void {
    for (const [id, ws] of this.clients) {
      // WebSocket.OPEN === 1
      if (ws.readyState === 1) {
        ws.send(data, (err) => {
          if (err) {
            log.error("Failed to send to client", { id, error: err.message });
          }
        });
      }
    }
  }

  get connectionCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const ws of this.clients.values()) {
      ws.terminate();
    }
    this.clients.clear();
    log.info("All clients terminated");
  }
}
