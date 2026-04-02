import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { WebSocketServer } from "ws";
import type { ClientManager } from "./clientManager.ts";
import { createLogger } from "../core/logger.ts";

const log = createLogger("ws-server");

const WS_PATH = "/ws";

export class WsServer {
  private readonly httpServer;
  private readonly wss: WebSocketServer;

  constructor(
    private readonly clientManager: ClientManager,
    private readonly httpHandler: (req: IncomingMessage, res: ServerResponse) => void,
  ) {
    this.httpServer = createServer(this.httpHandler);

    // noServer: we own the upgrade event to restrict the accepted path.
    this.wss = new WebSocketServer({ noServer: true });

    this.httpServer.on("upgrade", (req, socket, head) => {
      const { pathname } = new URL(req.url ?? "/", "http://localhost");

      if (pathname !== WS_PATH) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    });

    this.wss.on("connection", (ws, req) => {
      const ip = req.socket.remoteAddress ?? "unknown";
      log.info("WebSocket upgrade accepted", { ip });
      this.clientManager.register(ws);
    });

    this.wss.on("error", (err) => {
      log.error("WebSocketServer error", { error: err.message });
    });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(port, () => {
        log.info(`Server listening`, { port, wsPath: WS_PATH, restPath: "/price" });
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close(() => {
        this.httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
}
