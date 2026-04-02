import WebSocket from 'ws'
import { v4 as uuidv4 } from 'uuid'
import { createLogger } from '../core/logger.ts'

const log = createLogger('client-manager')

// Reject new connections beyond this ceiling to protect against EMFILE crashes
// and broadcast loop degradation. Tune via env var.
const MAX_CONNECTIONS = parseInt(process.env['MAX_WS_CONNECTIONS'] ?? '500', 10)

// Drop a client from the broadcast loop if its un-flushed send buffer exceeds
// this threshold. Prevents one slow consumer from growing our heap unboundedly.
const MAX_BUFFERED_BYTES = 1024 * 1024 // 1 MiB

// Ping interval and the time we wait for a pong before declaring a client dead.
const PING_INTERVAL_MS = 30_000
const PONG_TIMEOUT_MS = 10_000

// Owns the registry of live WebSocket connections.
// The only place that holds ws references — broadcaster and server both delegate here.
export class ClientManager {
  private readonly clients = new Map<string, WebSocket>()
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.startHeartbeat()
  }

  // Returns false when the connection ceiling is reached so the caller can send
  // a 503 and close the socket before it is registered.
  register(ws: WebSocket): string | null {
    if (this.clients.size >= MAX_CONNECTIONS) {
      log.warn('Connection limit reached; rejecting new client', {
        limit: MAX_CONNECTIONS,
      })
      ws.close(1013 /* Try Again Later */)
      return null
    }

    const id = uuidv4()
    // Attach a custom flag to track whether we are still waiting for a pong.
    ;(ws as WsWithAlive).isAlive = true

    this.clients.set(id, ws)
    log.info('Client connected', { id, total: this.clients.size })

    ws.on('pong', () => {
      ;(ws as WsWithAlive).isAlive = true
    })

    ws.on('close', () => this.unregister(id, 'close'))
    ws.on('error', err => {
      log.error('Client socket error', { id, error: err.message })
      this.unregister(id, 'error')
    })

    return id
  }

  private unregister(id: string, reason: string): void {
    if (this.clients.delete(id)) {
      log.info('Client disconnected', { id, reason, total: this.clients.size })
    }
  }

  broadcast(data: string): void {
    for (const [id, ws] of this.clients) {
      if (ws.readyState !== WebSocket.OPEN) continue

      // Drop this client's frame if its send buffer is already congested.
      // This bounds memory growth caused by slow or stalled consumers.
      if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
        log.warn('Client send buffer full; skipping frame', {
          id,
          bufferedAmount: ws.bufferedAmount,
        })
        continue
      }

      ws.send(data, err => {
        if (err) {
          log.error('Failed to send to client', { id, error: err.message })
        }
      })
    }
  }

  // Periodic ping sweep. Clients that do not respond within PONG_TIMEOUT_MS
  // are terminated, evicting zombie (half-open TCP) connections from the Map.
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, ws] of this.clients) {
        const alive = ws as WsWithAlive

        if (!alive.isAlive) {
          log.warn('Client failed heartbeat; terminating', { id })
          ws.terminate()
          // unregister fires via the 'close' event handler already attached.
          continue
        }

        // Mark dead; the pong listener above marks it alive again.
        alive.isAlive = false
        ws.ping()

        // Forcibly terminate if no pong arrives within the timeout window.
        setTimeout(() => {
          if (!alive.isAlive && ws.readyState === WebSocket.OPEN) {
            log.warn('Pong timeout; terminating client', { id })
            ws.terminate()
          }
        }, PONG_TIMEOUT_MS)
      }
    }, PING_INTERVAL_MS)

    // Do not prevent graceful process exit.
    this.heartbeatTimer.unref()
  }

  get connectionCount(): number {
    return this.clients.size
  }

  closeAll(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    for (const ws of this.clients.values()) {
      ws.terminate()
    }
    this.clients.clear()
    log.info('All clients terminated')
  }
}

// Augmented type used locally to carry the liveness flag on each socket.
type WsWithAlive = WebSocket & { isAlive: boolean }
