# pricecast

Real-time crypto price streaming service. Connects to the Binance WebSocket feed, normalises price events through an internal event queue, and broadcasts them to all connected WebSocket clients. Exposes a REST endpoint for snapshot lookups.

## Architecture

```
Binance WSS ──► BinanceListener ──► Parser ──► PriceEventQueue
                                                    │
                                        ┌───────────┴───────────┐
                                    PriceStore             Broadcaster
                                        │                       │
                                  GET /price             ClientManager
                                                               │
                                                     WebSocket clients
```

### Module boundaries

| Path                               | Responsibility                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `src/core/types.ts`                | Canonical `PriceEvent` type; `SUPPORTED_SYMBOLS`                                   |
| `src/core/queue.ts`                | Typed `EventEmitter` bus — the only coupling point between ingestion and consumers |
| `src/core/logger.ts`               | Structured JSON logger (stdout/stderr)                                             |
| `src/services/parser.ts`           | Pure function: Binance raw payload → `PriceEvent \| null`                          |
| `src/services/store.ts`            | In-memory `Map<symbol, PriceEvent>` — single write path via queue                  |
| `src/services/binance.listener.ts` | Binance WS connection, exponential-backoff reconnect                               |
| `src/services/broadcaster.ts`      | Queue subscriber; fans out to `ClientManager`; logs throughput metrics             |
| `src/ws/clientManager.ts`          | Client registry: register, unregister, broadcast                                   |
| `src/ws/server.ts`                 | HTTP server + WS upgrade handler (restricted to `/ws` path)                        |
| `src/api/price.controller.ts`      | `GET /price[?symbol=X]` handler                                                    |
| `src/app.ts`                       | Composition root; graceful shutdown on `SIGINT`/`SIGTERM`                          |

## Prerequisites

- [Bun](https://bun.sh) >= 1.0

## Development

```bash
# Install dependencies
bun install

# Run with hot-reload
bun dev

# Type-check only (no emit)
bun typecheck
```

## Production

```bash
# Run directly (Bun executes TypeScript natively)
bun start

# Build a self-contained binary
bun run build
./dist/pricecast
```

## Docker

```bash
# Build image
docker build -t pricecast .

# Run
docker run -p 8000:8000 pricecast

# Custom port
docker run -e PORT=9000 -p 9000:9000 pricecast
```

## API

### WebSocket

Connect to `ws://localhost:8000/ws`. Each message is a JSON `PriceEvent`:

```json
{
  "symbol": "BTCUSDT",
  "price": 82345.12,
  "change24h": 1.57,
  "timestamp": 1743600000000
}
```

### REST

```
GET /price
```

Returns all tracked symbols as `{ [symbol]: PriceEvent }`.

```
GET /price?symbol=BTCUSDT
```

Returns the latest `PriceEvent` for a single symbol, or `404` if not yet received.

## Environment

| Variable | Default | Description                  |
| -------- | ------- | ---------------------------- |
| `PORT`   | `8000`  | HTTP + WebSocket listen port |

## Supported symbols

`BTCUSDT`, `ETHUSDT` — controlled by `SUPPORTED_SYMBOLS` in `src/core/types.ts`.
