import type { IncomingMessage, ServerResponse } from "http";
import type { PriceStore } from "../services/store.ts";
import { createLogger } from "../core/logger.ts";

const log = createLogger("rest-api");

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Returns a request handler that can be passed directly to http.createServer / WsServer.
// Handles:  GET /price          → all latest prices
//           GET /price?symbol=X → single symbol
//           everything else     → 404
export function createPriceController(store: PriceStore) {
  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");

    if (req.method !== "GET" || pathname !== "/price") {
      json(res, 404, { error: "Not found" });
      return;
    }

    const symbol = searchParams.get("symbol")?.toUpperCase();

    if (symbol) {
      const event = store.get(symbol);
      if (!event) {
        log.warn("Symbol not found in store", { symbol });
        json(res, 404, { error: `No data for symbol: ${symbol}` });
        return;
      }
      json(res, 200, event);
      return;
    }

    json(res, 200, store.getAll());
  };
}
