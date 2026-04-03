# pricecast

A production-grade real-time crypto price streaming service built with Node.js and TypeScript. It connects to the Binance WebSocket feed, processes incoming price ticks through a decoupled internal event queue, and broadcasts live updates to all connected WebSocket clients. A REST endpoint is available for point-in-time price snapshots.

## How it works

```
Binance WSS ──► Listener ──► Parser ──► EventQueue ──► Broadcaster ──► WebSocket clients
                                             │
                                          PriceStore ──► GET /price
```

1. **BinanceListener** maintains a persistent connection to Binance's combined ticker stream. If the connection drops it automatically reconnects with exponential backoff (1 s → 30 s). A circuit breaker stops retrying after 10 consecutive failures.

2. **Parser** converts the raw Binance payload into a normalised `PriceEvent` — `{ symbol, price, change24h, timestamp }`. This is the only place in the codebase that knows Binance's wire format.

3. **EventQueue** is a typed `EventEmitter` wrapper that acts as the internal message bus. The listener publishes to it; `PriceStore` and `Broadcaster` subscribe independently. Neither side knows the other exists.

4. **Broadcaster** receives every event from the queue and fans it out to all connected WebSocket clients as a JSON string.

5. **PriceStore** keeps the latest price per symbol in memory. It powers the REST API.

6. **WebSocket server** accepts client connections on `ws://localhost:8000/ws`. Incoming connections pass through a per-IP token-bucket rate limiter (HTTP `429` if exceeded) and a global connection ceiling (WS close `1013` if exceeded). A periodic ping/pong sweep evicts zombie connections.

## Setup

```bash
cp .env.example .env
bun install
```

## Running

```bash
# Development (hot reload)
bun dev

# Production
bun start
```

## Docker

```bash
docker build -t pricecast .
docker run --env-file .env -p 8000:8000 pricecast
```

## WebSocket

Connect to `ws://localhost:8000/ws`. You will receive a message on every Binance tick:

```json
{
  "symbol": "BTCUSDT",
  "price": 82345.12,
  "change24h": 1.57,
  "timestamp": 1743600000000
}
```

Supported symbols: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`

## REST API

```
GET /                        — health check (status, uptime, tracked symbol count)
GET /price                   — latest prices for all symbols
GET /price?symbol=BTCUSDT    — latest price for a single symbol
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Listen port |
| `MAX_WS_CONNECTIONS` | `500` | Global WebSocket connection ceiling |
| `RL_BUCKET_CAPACITY` | `5` | Max connection burst per IP |
| `RL_REFILL_RATE` | `1` | Tokens refilled per interval |
| `RL_REFILL_INTERVAL_MS` | `10000` | Refill interval in ms |
