import type { Duplex } from 'stream'
import { createLogger } from '../core/logger.ts'

const log = createLogger('rate-limiter')

// Token bucket config — tunable via environment variables.
// A client starts with a full bucket and consumes one token per connection attempt.
// Tokens refill at REFILL_RATE per REFILL_INTERVAL_MS.
const BUCKET_CAPACITY = parseInt(process.env['RL_BUCKET_CAPACITY'] ?? '5', 10)
const REFILL_RATE = parseInt(process.env['RL_REFILL_RATE'] ?? '1', 10)
const REFILL_INTERVAL_MS = parseInt(process.env['RL_REFILL_INTERVAL_MS'] ?? '10000', 10)

// Evict stale bucket entries after this long without a connection attempt.
// Keeps the Map from growing indefinitely for IPs that disappear.
const EVICT_AFTER_MS = 5 * 60 * 1_000 // 5 minutes

type Bucket = {
  tokens: number
  lastRefillAt: number
  lastSeenAt: number
}

export class IpRateLimiter {
  private readonly buckets = new Map<string, Bucket>()
  private readonly evictTimer: ReturnType<typeof setInterval>

  constructor() {
    // Periodic sweep to evict buckets for long-gone IPs.
    this.evictTimer = setInterval(() => this.evictStale(), EVICT_AFTER_MS)
    this.evictTimer.unref()
  }

  // Returns true if the request should be allowed, false if it should be rejected.
  consume(ip: string): boolean {
    const now = Date.now()
    const bucket = this.getOrCreate(ip, now)

    // Refill tokens proportional to elapsed time since last refill.
    const elapsed = now - bucket.lastRefillAt
    const tokensToAdd = Math.floor(elapsed / REFILL_INTERVAL_MS) * REFILL_RATE

    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + tokensToAdd)
      bucket.lastRefillAt = now
    }

    bucket.lastSeenAt = now

    if (bucket.tokens < 1) {
      log.warn('Rate limit exceeded', {
        ip,
        tokens: bucket.tokens,
        refillsIn: REFILL_INTERVAL_MS - (elapsed % REFILL_INTERVAL_MS),
      })
      return false
    }

    bucket.tokens--
    return true
  }

  // Reject the connection with an HTTP 429 on the raw socket and destroy it.
  // Must be called before handleUpgrade() — at this point the socket is still
  // in HTTP mode so a plain HTTP response is valid and readable by the client.
  reject(socket: Duplex, retryAfterSec: number): void {
    socket.write(
      `HTTP/1.1 429 Too Many Requests\r\n` +
        `Content-Type: text/plain\r\n` +
        `Retry-After: ${retryAfterSec}\r\n` +
        `Connection: close\r\n` +
        `\r\n` +
        `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
    )
    socket.destroy()
  }

  destroy(): void {
    clearInterval(this.evictTimer)
    this.buckets.clear()
  }

  private getOrCreate(ip: string, now: number): Bucket {
    let bucket = this.buckets.get(ip)
    if (!bucket) {
      bucket = { tokens: BUCKET_CAPACITY, lastRefillAt: now, lastSeenAt: now }
      this.buckets.set(ip, bucket)
    }
    return bucket
  }

  private evictStale(): void {
    const cutoff = Date.now() - EVICT_AFTER_MS
    let evicted = 0
    for (const [ip, bucket] of this.buckets) {
      if (bucket.lastSeenAt < cutoff) {
        this.buckets.delete(ip)
        evicted++
      }
    }
    if (evicted > 0) {
      log.info('Evicted stale rate-limit buckets', { evicted, remaining: this.buckets.size })
    }
  }
}
