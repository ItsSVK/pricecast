import { EventEmitter } from 'events'
import type { PriceEvent } from './types.ts'

// Typed wrapper around EventEmitter.
// Acts as the internal bus between ingestion (BinanceListener) and consumers
// (PriceStore, Broadcaster). Keeps both sides unaware of each other.
const PRICE_EVENT = 'price'

type PriceHandler = (event: PriceEvent) => void

export class PriceEventQueue {
  private readonly emitter = new EventEmitter()

  constructor() {
    // Raise the ceiling to support many simultaneous subscribers without warnings.
    this.emitter.setMaxListeners(20)
  }

  publish(event: PriceEvent): void {
    this.emitter.emit(PRICE_EVENT, event)
  }

  subscribe(handler: PriceHandler): void {
    this.emitter.on(PRICE_EVENT, handler)
  }

  unsubscribe(handler: PriceHandler): void {
    this.emitter.off(PRICE_EVENT, handler)
  }
}
