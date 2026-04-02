// Composition root — instantiates and wires all modules, then starts the server.
// Nothing here contains business logic; it only knows how to assemble and tear down.

import { PriceEventQueue } from "./core/queue.ts";
import { createLogger } from "./core/logger.ts";

import { PriceStore } from "./services/store.ts";
import { BinanceListener } from "./services/binance.listener.ts";
import { Broadcaster } from "./services/broadcaster.ts";

import { ClientManager } from "./ws/clientManager.ts";
import { WsServer } from "./ws/server.ts";

import { createPriceController } from "./api/price.controller.ts";

const log = createLogger("app");

const PORT = parseInt(process.env["PORT"] ?? "8000", 10);

async function main(): Promise<void> {
  // 1. Core event bus
  const queue = new PriceEventQueue();

  // 2. Consumers subscribe before the producer starts (no lost events)
  const store = new PriceStore(queue);
  const clientManager = new ClientManager();
  new Broadcaster(queue, clientManager);

  // 3. HTTP + WebSocket server
  const httpHandler = createPriceController(store);
  const server = new WsServer(clientManager, httpHandler);
  await server.listen(PORT);

  // 4. Start ingestion last — connections are ready to receive
  const listener = new BinanceListener(queue);
  listener.start();

  // 5. Graceful shutdown
  async function shutdown(signal: string): Promise<void> {
    log.info("Shutdown initiated", { signal });

    // Stop accepting new Binance data
    listener.close();

    // Disconnect all WebSocket clients cleanly
    clientManager.closeAll();

    // Stop HTTP + WS server (stops new connections and existing upgrades)
    try {
      await server.close();
    } catch (err) {
      log.error("Error closing server", { error: String(err) });
    }

    log.info("Shutdown complete");
    process.exit(0);
  }

  process.on("SIGINT",  () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  process.on("uncaughtException", (err) => {
    log.error("Uncaught exception", { error: err.message, stack: err.stack });
    void shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection", { reason: String(reason) });
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ level: "error", service: "app", message }) + "\n");
  process.exit(1);
});
