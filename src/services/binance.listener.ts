import WebSocket from 'ws'
import { parse } from './parser.ts'
import type { PriceEventQueue } from '../core/queue.ts'
import { createLogger } from '../core/logger.ts'
import { SUPPORTED_SYMBOLS } from '../core/types.ts'

const log = createLogger('binance-listener')

const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream'
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 30_000

// Circuit breaker: after this many consecutive failed attempts without a
// successful open, stop reconnecting. Prevents infinite retry loops on
// permanent failures (IP ban, TLS cert error, DNS resolution failure).
const MAX_CONSECUTIVE_FAILURES = 10

// Cap the exponent so 2**attempt never produces Infinity.
const BACKOFF_EXPONENT_CAP = 10

function buildStreamUrl(): string {
  const streams = SUPPORTED_SYMBOLS.map(s => `${s.toLowerCase()}@ticker`).join('/')
  return `${BINANCE_WS_BASE}?streams=${streams}`
}

export class BinanceListener {
  private ws: WebSocket | null = null
  private reconnectAttempt = 0
  private destroyed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Circuit breaker state: counts closes/errors since the last successful open.
  private consecutiveFailures = 0

  constructor(private readonly queue: PriceEventQueue) {}

  start(): void {
    this.connect()
  }

  private connect(): void {
    if (this.destroyed) return

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      log.error('Circuit breaker open: too many consecutive failures; giving up', {
        failures: this.consecutiveFailures,
        max: MAX_CONSECUTIVE_FAILURES,
      })
      // Emit a clearly observable signal — callers can hook into this if needed.
      process.emit('binanceCircuitOpen' as NodeJS.Signals)
      return
    }

    const url = buildStreamUrl()
    log.info('Connecting to Binance WebSocket', {
      url,
      attempt: this.reconnectAttempt + 1,
    })

    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      // Successful connection resets both the backoff counter and the circuit breaker.
      this.reconnectAttempt = 0
      this.consecutiveFailures = 0
      log.info('Binance WebSocket connected')
    })

    this.ws.on('message', (raw: WebSocket.RawData) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        log.warn('Failed to JSON-parse Binance message')
        return
      }

      const event = parse(parsed)
      if (event === null) {
        log.debug('Skipped unparseable Binance payload')
        return
      }

      this.queue.publish(event)
    })

    this.ws.on('error', err => {
      log.error('Binance WebSocket error', { error: err.message })
      // 'error' is always followed by 'close', so we increment failures there.
    })

    this.ws.on('close', (code, reason) => {
      log.warn('Binance WebSocket closed', { code, reason: reason.toString() })
      this.consecutiveFailures++
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return

    // Exponential backoff with a capped exponent so the value is always finite.
    const exponent = Math.min(this.reconnectAttempt, BACKOFF_EXPONENT_CAP)
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS)
    this.reconnectAttempt++

    log.info(`Reconnecting to Binance in ${delay}ms`, {
      attempt: this.reconnectAttempt,
      consecutiveFailures: this.consecutiveFailures,
    })
    this.reconnectTimer = setTimeout(() => this.connect(), delay)
  }

  close(): void {
    this.destroyed = true
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
    }
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.terminate()
      this.ws = null
    }
    log.info('BinanceListener closed')
  }
}
