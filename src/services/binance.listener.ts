import WebSocket from "ws";
import { parse } from "./parser.ts";
import type { PriceEventQueue } from "../core/queue.ts";
import { createLogger } from "../core/logger.ts";
import { SUPPORTED_SYMBOLS } from "../core/types.ts";

const log = createLogger("binance-listener");

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/stream";
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function buildStreamUrl(): string {
  const streams = SUPPORTED_SYMBOLS.map((s) => `${s.toLowerCase()}@ticker`).join("/");
  return `${BINANCE_WS_BASE}?streams=${streams}`;
}

export class BinanceListener {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly queue: PriceEventQueue) {}

  start(): void {
    this.connect();
  }

  private connect(): void {
    if (this.destroyed) return;

    const url = buildStreamUrl();
    log.info("Connecting to Binance WebSocket", { url });

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.reconnectAttempt = 0;
      log.info("Binance WebSocket connected");
    });

    this.ws.on("message", (raw: WebSocket.RawData) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        log.warn("Failed to JSON-parse Binance message");
        return;
      }

      const event = parse(parsed);
      if (event === null) {
        log.debug("Skipped unparseable Binance payload");
        return;
      }

      this.queue.publish(event);
    });

    this.ws.on("error", (err) => {
      log.error("Binance WebSocket error", { error: err.message });
    });

    this.ws.on("close", (code, reason) => {
      log.warn("Binance WebSocket closed", { code, reason: reason.toString() });
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;

    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt++;

    log.info(`Reconnecting to Binance in ${delay}ms`, { attempt: this.reconnectAttempt });
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  close(): void {
    this.destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.terminate();
      this.ws = null;
    }
    log.info("BinanceListener closed");
  }
}
