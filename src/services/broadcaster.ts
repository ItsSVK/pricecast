import type { PriceEventQueue } from '../core/queue.ts'
import type { ClientManager } from '../ws/clientManager.ts'
import type { PriceEvent } from '../core/types.ts'
import { createLogger } from '../core/logger.ts'

const log = createLogger('broadcaster')

// Pure fan-out: subscribes to the queue, serialises events, hands off to ClientManager.
// Contains zero business logic — that boundary is intentional and enforced.
export class Broadcaster {
  private readonly messageCounts = new Map<string, number>()
  private totalMessages = 0

  constructor(
    private readonly queue: PriceEventQueue,
    private readonly clientManager: ClientManager,
  ) {
    this.queue.subscribe(event => this.onEvent(event))
    log.info('Broadcaster subscribed to queue')
  }

  private onEvent(event: PriceEvent): void {
    const payload = JSON.stringify(event)
    this.clientManager.broadcast(payload)
    this.totalMessages += 1
    this.trackMetrics(event.symbol)
  }

  get totalMessageCount(): number {
    return this.totalMessages
  }

  // Lightweight throughput metric — logs every 100 messages per symbol.
  private trackMetrics(symbol: string): void {
    const count = (this.messageCounts.get(symbol) ?? 0) + 1
    this.messageCounts.set(symbol, count)
    if (count % 100 === 0) {
      log.info('Broadcast milestone', {
        symbol,
        messages: count,
        clients: this.clientManager.connectionCount,
      })
    }
  }
}
