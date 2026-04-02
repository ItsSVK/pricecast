import type { PriceEvent } from '../core/types.ts'
import type { PriceEventQueue } from '../core/queue.ts'
import { createLogger } from '../core/logger.ts'

const log = createLogger('store')

// Single source of truth for the latest price per symbol.
// Write path: queue subscription only — nothing else writes here.
// Read path: REST controller and anything needing a snapshot.
export class PriceStore {
  private readonly store = new Map<string, PriceEvent>()

  constructor(queue: PriceEventQueue) {
    queue.subscribe(event => this.set(event))
    log.info('PriceStore subscribed to queue')
  }

  private set(event: PriceEvent): void {
    this.store.set(event.symbol, event)
  }

  get(symbol: string): PriceEvent | undefined {
    return this.store.get(symbol.toUpperCase())
  }

  getAll(): Record<string, PriceEvent> {
    return Object.fromEntries(this.store.entries())
  }

  get size(): number {
    return this.store.size
  }
}
